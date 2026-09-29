import {createInterface} from 'node:readline/promises';
import {writeFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
const key=process.env.REDBARK_SETUP_API_KEY,origin=process.env.APP_ORIGIN,version=process.env.REDBARK_API_VERSION||'2026-10-01.wattle';
if(!key||!origin)throw new Error('Set REDBARK_SETUP_API_KEY and APP_ORIGIN in your local environment.');
const base=new URL(origin);if(base.protocol!=='https:')throw new Error('An HTTPS production app origin is required.');
async function api(path,body){const url=new URL(path.startsWith('https://')?path:'https://api.redbark.com/v2'+path);if(url.origin!=='https://api.redbark.com'||!url.pathname.startsWith('/v2/'))throw new Error('Unexpected API address');const r=await fetch(url,{method:body?'POST':'GET',headers:{Authorization:`Bearer ${key}`,'Redbark-Version':version,'Content-Type':'application/json',...(body?{'Idempotency-Key':randomUUID()}:{})},body:body?JSON.stringify(body):undefined,redirect:'error'});if(!r.ok)throw new Error(`Redbark returned ${r.status}; check plan, scopes and consent.`);return r.json();}
const rl=createInterface({input:process.stdin,output:process.stdout});let accounts=[],path='/accounts?limit=100';while(path){const page=await api(path);accounts.push(...page.data.filter(a=>a.provider==='fiskil'&&a.category==='banking'&&a.currency==='aud'));path=page.next_page_url;}
accounts.forEach((a,i)=>console.log(`${i+1}. ${a.name} ${a.account_number??''} (${a.id})`));const choice=await rl.question('Choose account numbers, comma-separated (same accounts selected in Rentledger): ');const selected=[...new Set(choice.split(',').map(x=>Number(x.trim())-1))].map(i=>accounts[i]);if(!selected.length||selected.some(a=>!a))throw new Error('Invalid account selection.');
const confirm=await rl.question(`Create transaction and lifecycle webhooks for ${base.origin}? [yes/no] `);rl.close();if(confirm!=='yes')process.exit(0);
const url=base.origin+'/api/webhooks/redbark';
const destination=await api('/destinations',{type:'webhook',name:'Rentledger transactions',target:{url}});
if(!destination.config?.signing_secret)throw new Error('No signing secret returned. Inspect the destination in Redbark before proceeding.');
// Save the one-time secret immediately in an ignored, owner-readable file.
const filename='.env.redbark.local';await writeFile(filename,`REDBARK_WEBHOOK_SECRET=${destination.config.signing_secret}\n`,{mode:0o600,flag:'wx'});
console.log(`Signing secret saved to ${filename}. Add it to your hosting environment before enabling delivery.`);
const event=await api('/event_destinations',{name:'Rentledger consent and lifecycle',webhook_endpoint:{url},enabled_events:['connection.*','sync_run.failed','event_destination.disabled']});
if(event.webhook_endpoint?.signing_secret)await writeFile(filename,`REDBARK_EVENT_SECRET=${event.webhook_endpoint.signing_secret}\n`,{mode:0o600,flag:'a'});
const from=new Date(Date.now()-90*86400000).toISOString().slice(0,10);
const sync=await api('/syncs',{type:'transactions',name:'Rentledger live bank feed',destination:destination.id,accounts:selected.map(a=>a.id),options:{data_from:from,include_pending:false,mask_account_numbers:true},run_now:false});
console.log(`Created sync ${sync.id}. Add the secrets to your host, redeploy, then run this sync once in Redbark. Verify a 202 delivery. The app's scheduled polling already works without webhook delivery.`);

import test from 'node:test';
import assert from 'node:assert/strict';
import {emptyState,type State} from '../lib/engine/types';
import {executeCommand} from '../lib/engine/commands';
import {paid} from '../lib/engine/ledger';
import {addDays,localDate,weekStart} from '../lib/engine/dates';
import {mutate,supabaseHeaders} from '../lib/server/database';
import {refreshDirectory,runSync} from '../lib/server/sync';
// runSync() talks to Supabase (PostgREST RPC) and Redbark over fetch. Both are
// faked in memory, so this exercises the real orchestration without credentials.
// It is not evidence of live bank connectivity.
process.env.SUPABASE_URL='https://db.example.test';process.env.SUPABASE_SERVICE_ROLE_KEY='test-service-key';process.env.REDBARK_API_KEY='rbk_test_key';
type Row=Record<string,unknown>;
const db={state:null as State|null,revision:0};
const okBalance={status:200,body:{object:'balance',account:'acct_1',current:{amount:123400,currency:'aud'},available:null,currency:'aud',observed_at:'2026-10-19T00:00:00.000Z',freshness:'fresh'} as unknown};
const bank={transactions:[] as Row[],transactionError:null as null|{status:number;code:string},balance:okBalance};
const connection={id:'conn_1',object:'connection',provider:'fiskil',category:'banking',institution:{id:'inst_fk_1',name:'Test Bank',logo:null},status:'active',consent:{id:'cons_1',status:'active',expires_at:'2027-09-01T00:00:00.000Z'},account_count:1,last_refreshed_at:'2026-10-19T00:00:00.000Z',ready_at:null,metadata:{},livemode:true};
const account={id:'acct_1',object:'account_item',connection:'conn_1',provider:'fiskil',category:'banking',name:'Rent account',type:'transaction',account_number:'xxxx1234',currency:'aud',status:'available',livemode:true};
const list=(data:unknown[])=>Response.json({object:'list',data,next_page_url:null,previous_page_url:null});
const providerError=(status:number,code:string,headers:Record<string,string>={})=>Response.json({error:{type:'upstream_error',code,message:code,param:null,doc_url:null,request_id:'req_test'}},{status,headers});
globalThis.fetch=(async(input:RequestInfo|URL,init?:RequestInit)=>{
 const url=new URL(String(input));
 if(url.origin==='https://db.example.test'){const name=url.pathname.split('/').at(-1),args=JSON.parse(String(init?.body??'{}'));
  if(name==='claim_job')return Response.json(true);if(name==='release_job')return Response.json(null);
  if(name==='ledger_snapshot')return Response.json(db.state?{...structuredClone(db.state),revision:db.revision,schemaVersion:2}:null);
  if(name==='ledger_commit'){if(args.p_expected!==db.revision)return Response.json({code:'40001'},{status:409});db.state=structuredClone(args.p_state);db.revision++;return Response.json(db.revision);}
  throw new Error('Unexpected RPC '+name);}
 if(url.origin==='https://api.redbark.com'){
  if(url.pathname==='/v2/connections')return list([connection]);
  if(url.pathname==='/v2/accounts')return list([account]);
  if(url.pathname==='/v2/transactions'){if(bank.transactionError)return providerError(bank.transactionError.status,bank.transactionError.code);const from=url.searchParams.get('from')!,to=url.searchParams.get('to')!;return list(bank.transactions.filter(t=>String(t.date)>=from&&String(t.date)<=to));}
  if(url.pathname==='/v2/accounts/acct_1/balance')return bank.balance.status===200?Response.json(bank.balance.body):providerError(bank.balance.status,'balance_refresh_limited',{'Retry-After':'900'});
 }
 throw new Error('Unexpected request '+url);
}) as typeof fetch;
const today=localDate(new Date(),'Australia/Perth'),start=addDays(weekStart(today),-14);
const tx=(id:string,date:string,amount:number,status:'posted'|'pending'='posted',currency='aud'):Row=>({id,object:'transaction',account:'acct_1',status,date,post_date:status==='posted'?date:null,description:'SARAH SMITH',reference:'ROOM 1',extended_description:null,merchant_name:null,amount:{amount,currency},direction:amount>0?'credit':'debit',livemode:true});
const state=()=>db.state!;
const rentFor=(date:string)=>state().rents.find(r=>r.active&&r.periodStart===date)!;
test('scheduled sync against faked Supabase and Redbark',async t=>{
 let s=emptyState();const now=new Date();s=executeCommand(s,{type:'property',name:'Home',address:'Perth WA'},now);s=executeCommand(s,{type:'room',propertyId:s.properties[0].id,name:'Room 1'},now);s=executeCommand(s,{type:'tenant',name:'Sarah Smith',roomId:s.rooms[0].id,startDate:start,weeklyRent:'250',aliases:['SARAH SMITH']},now);db.state=s;db.revision=0;
 await refreshDirectory();await mutate(x=>executeCommand(x,{type:'selectAccount',accountId:x.accounts[0].id,propertyId:x.properties[0].id,selected:true}));
 await t.test('first run imports posted and pending rows, matches rent and records health',async()=>{bank.transactions=[tx('txn_fk_1',start,25000),tx('txn_fk_p1',addDays(today,-1),25000,'pending')];const r=await runSync();assert.equal(r.success,true);assert.equal(r.imported,2);assert.equal(paid(state(),'rent',rentFor(start).id),25000);const a=state().accounts[0];assert.ok(a.lastSyncedAt);assert.equal(a.balanceCents,123400);assert.equal(state().connections[0].error,null);assert.ok(state().connections[0].lastSyncedAt);assert.ok(state().audit.some(x=>x.event==='full_sync_completed'));});
 await t.test('a settled pending row is superseded and a rate-limited balance does not mark the feed failed',async()=>{const before=state().accounts[0].lastSyncedAt!;bank.transactions=[tx('txn_fk_1',start,25000),tx('txn_fk_2',addDays(today,-1),25000)];bank.balance={status:429,body:null};const r=await runSync();assert.equal(r.success,true);assert.equal(r.imported,1);const pending=state().transactions.find(x=>x.providerId==='txn_fk_p1')!;assert.equal(pending.bankStatus,'superseded');assert.equal(state().transactions.filter(x=>x.bankStatus==='pending').length,0);assert.equal(paid(state(),'rent',rentFor(addDays(start,7)).id),25000);assert.equal(state().accounts[0].balanceCents,123400);assert.equal(state().connections[0].error,null);assert.ok(state().accounts[0].lastSyncedAt!>before);bank.balance=okBalance;});
 await t.test('repeat runs are idempotent and routine no-change runs are not audited',async()=>{const counts=()=>[state().transactions.length,state().allocations.length,state().audit.filter(x=>x.event==='sync_completed').length].join();const before=counts();await runSync();await runSync();assert.equal(counts(),before);});
 await t.test('a foreign-currency row is skipped without failing the feed',async()=>{bank.transactions.push(tx('txn_fk_usd',addDays(today,-1),-1999,'posted','usd'));const r=await runSync();assert.equal(r.success,true);assert.equal(r.foreignSkipped,1);assert.equal(state().transactions.some(x=>x.providerId==='txn_fk_usd'),false);});
 await t.test('a rejected consent fails that connection with guidance, then recovers',async()=>{bank.transactionError={status:424,code:'upstream_auth_failed'};const r=await runSync();assert.equal(r.success,false);assert.match(state().connections[0].error??'',/Renew consent/);assert.ok(state().notifications.some(n=>n.key.startsWith('bank:')&&!n.resolved));bank.transactionError=null;const ok=await runSync();assert.equal(ok.success,true);assert.equal(state().connections[0].error,null);assert.equal(state().notifications.some(n=>n.key===`bank:${state().connections[0].id}`&&!n.resolved),false);});
 await t.test('recorded webhook events raise Redbark delivery notices and are marked processed',async()=>{await mutate(x=>{x.webhookEvents.push({id:crypto.randomUUID(),providerEventId:'evt_disabled',type:'destination.disabled',receivedAt:new Date().toISOString(),processedAt:null});});await runSync();assert.ok(state().notifications.some(n=>n.key==='bank:redbark-destination'&&!n.resolved));assert.ok(state().webhookEvents.every(e=>e.processedAt));});
 await t.test('without a Redbark key, rent is still generated and the run says why it skipped the bank',async()=>{delete process.env.REDBARK_API_KEY;try{const r=await runSync();assert.equal(r.reason,'bank_not_configured');assert.ok(state().rents.length>=3);}finally{process.env.REDBARK_API_KEY='rbk_test_key';}});
});
test('Supabase secret keys go only in the apikey header; legacy service_role JWTs also as a bearer token',()=>{assert.deepEqual(Object.keys(supabaseHeaders('sb_secret_example')).sort(),['Content-Type','apikey']);assert.equal(supabaseHeaders('eyJhbGciOiJIUzI1NiJ9.legacy.sig').Authorization,'Bearer eyJhbGciOiJIUzI1NiJ9.legacy.sig');});

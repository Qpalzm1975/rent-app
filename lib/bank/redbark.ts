import { z } from 'zod';
import { addDays,daysBetween,validDate } from '../engine/dates';
const nullableText=z.string().nullable();
const date=z.string().refine(validDate);
const money=z.object({amount:z.number().int().safe(),currency:z.literal('aud')});
export const transactionSchema=z.object({id:z.string().min(1),account:z.string().min(1),status:z.enum(['posted','pending']),date,post_date:date.nullable(),description:z.string(),reference:nullableText,extended_description:nullableText,merchant_name:nullableText,amount:money,direction:z.enum(['credit','debit']),livemode:z.literal(true)}).passthrough();
export type ProviderTransaction=z.infer<typeof transactionSchema>;
export const connectionSchema=z.object({id:z.string(),provider:z.literal('fiskil'),category:z.literal('banking'),institution:z.object({name:z.string()}).nullable(),status:z.enum(['pending','active','expiring','expired','invalidated','revoked']),consent:z.object({expires_at:nullableText}).nullable(),last_refreshed_at:nullableText,livemode:z.literal(true)}).passthrough();
export type ProviderConnection=z.infer<typeof connectionSchema>;
export const accountSchema=z.object({id:z.string(),connection:z.string(),provider:z.literal('fiskil'),category:z.literal('banking'),name:z.string(),account_number:nullableText,currency:z.literal('aud'),livemode:z.literal(true)}).passthrough();
export type ProviderAccount=z.infer<typeof accountSchema>;
export const balanceSchema=z.object({account:z.string(),current:money.nullable(),available:money.nullable(),observed_at:nullableText,freshness:nullableText}).passthrough();
export type ProviderBalance=z.infer<typeof balanceSchema>;
const BASE='https://api.redbark.com/v2';
export const REDBARK_VERSION='2026-10-01.wattle';
export class ProviderError extends Error{constructor(public status:number,public code:string){super(`Redbark ${status}: ${code}. Check bank consent, key scopes and connection status.`);}}
export class RedbarkClient {
 constructor(private key:string,private version=REDBARK_VERSION,private fetcher:typeof fetch=fetch){if(!key)throw new Error('Configure the server-side Redbark API key first.');}
 async request(path:string,body?:unknown,idempotencyKey?:string):Promise<{data:unknown;truncated:boolean}>{
  const u=new URL(path.startsWith('https://')?path:BASE+path);if(u.origin!=='https://api.redbark.com'||!u.pathname.startsWith('/v2/')||u.username||u.password)throw new Error('Rejected unexpected Redbark URL.');
  for(let attempt=0;attempt<3;attempt++){
   const r=await this.fetcher(u,{method:body===undefined?'GET':'POST',headers:{Authorization:`Bearer ${this.key}`,'Redbark-Version':this.version,...(body!==undefined?{'Content-Type':'application/json'}:{}),...(idempotencyKey?{'Idempotency-Key':idempotencyKey}:{})},body:body===undefined?undefined:JSON.stringify(body),cache:'no-store',redirect:'error',signal:AbortSignal.timeout(20000)});
   if(!r.ok){const retry=Number(r.headers.get('Retry-After')??'1');if([429,500,503].includes(r.status)&&attempt<2&&Number.isFinite(retry)&&retry<=5){await new Promise(resolve=>setTimeout(resolve,Math.max(retry,1)*1000));continue;}const e=await r.json().catch(()=>null);const code=z.object({error:z.object({code:z.string().max(100)})}).safeParse(e);throw new ProviderError(r.status,code.success?code.data.error.code:'request_failed');}
   return {data:await r.json(),truncated:r.headers.get('X-Redbark-Truncated')==='true'};
  }
  throw new ProviderError(503,'retry_exhausted');
 }
 async list<T>(path:string,schema:z.ZodType<T>):Promise<T[]>{
  const items:T[]=[],seen=new Set<string>();let url:string|null=path;
  for(let pages=0;url;pages++){
   if(pages>=100||seen.has(url))throw new Error('Bank pagination did not complete. No successful sync was recorded.');seen.add(url);
   const response=await this.request(url);if(response.truncated)throw new ProviderError(413,'transaction_window_truncated');
   const page=z.object({object:z.literal('list'),data:z.array(schema),next_page_url:z.string().nullable()}).parse(response.data);items.push(...page.data);url=page.next_page_url;
  }
  return items;
 }
 async connections(){const rows=await this.list('/connections?provider=fiskil&limit=100',z.record(z.unknown()));return rows.filter(r=>r.provider==='fiskil'&&r.category==='banking').map(r=>connectionSchema.parse(r));}
 async accounts(){const rows=await this.list('/accounts?limit=100',z.record(z.unknown()));return rows.filter(r=>r.provider==='fiskil'&&r.category==='banking'&&r.currency==='aud').map(r=>accountSchema.parse(r));}
 async balance(account:string){return balanceSchema.parse((await this.request(`/accounts/${encodeURIComponent(account)}/balance`)).data);}
 async transactions(account:string,from:string,to:string):Promise<ProviderTransaction[]>{
  try{return await this.list(`/transactions?account=${encodeURIComponent(account)}&from=${from}&to=${to}&include_pending=true&limit=100`,transactionSchema);}
  catch(e){if(e instanceof ProviderError&&e.code==='transaction_window_truncated'&&from<to){const middle=addDays(from,Math.floor(daysBetween(from,to)/2));return [...await this.transactions(account,from,middle),...await this.transactions(account,addDays(middle,1),to)];}throw e;}
 }
 async link(returnUrl:string,connectionId?:string){const path=connectionId?`/connections/${encodeURIComponent(connectionId)}/reauthorize`:'/link_sessions';const body=connectionId?{return_url:returnUrl}:{provider:'fiskil',return_url:returnUrl};const result=z.object({url:z.string().url(),id:z.string()}).parse((await this.request(path,body,crypto.randomUUID())).data);const url=new URL(result.url);if(url.protocol!=='https:'||url.hostname!=='app.redbark.com')throw new Error('Redbark returned an unexpected consent address.');return result;}
}

import 'server-only';
import type { State } from '../engine/types';
import { emptyState } from '../engine/types';
import { env } from './env';
export class DatabaseError extends Error{constructor(public code:string,message:string){super(message);}}
// Supabase secret keys (sb_secret_…) are not JWTs and belong only in the apikey
// header; Supabase is retiring the legacy service_role JWT (also accepted here,
// sent as a bearer token as before) by the end of 2026.
export function supabaseHeaders(key:string):Record<string,string>{return key.startsWith('sb_')?{'Content-Type':'application/json',apikey:key}:{'Content-Type':'application/json',apikey:key,Authorization:`Bearer ${key}`};}
export async function rpc<T>(name:string,args:Record<string,unknown>):Promise<T>{
 const url=env('SUPABASE_URL'),key=env('SUPABASE_SERVICE_ROLE_KEY');if(!url||!key)throw new DatabaseError('not_configured','Add your Supabase server credentials before saving financial records.');
 if(!url.startsWith('https://')&&process.env.NODE_ENV==='production')throw new Error('The database must use HTTPS.');
 const r=await fetch(`${url.replace(/\/$/,'')}/rest/v1/rpc/${name}`,{method:'POST',headers:supabaseHeaders(key),body:JSON.stringify(args),cache:'no-store',signal:AbortSignal.timeout(20000)});
 if(!r.ok){const e=await r.json().catch(()=>({})) as {code?:string};if(e.code==='40001')throw new DatabaseError('revision_conflict','The ledger changed. Please retry.');throw new DatabaseError(e.code??'database_error','The database could not complete the request. Check migrations and server configuration.');}
 return await r.json() as T;
}
export async function snapshot():Promise<State>{return await rpc<State|null>('ledger_snapshot',{p_owner:'owner'})??emptyState();}
export async function mutate<T>(fn:(state:State)=>T):Promise<{state:State;result:T}>{
 for(let attempt=0;attempt<4;attempt++){
  const state=await snapshot(),expected=state.revision;const result=fn(state);
  try {state.revision=await rpc<number>('ledger_commit',{p_owner:'owner',p_expected:expected,p_state:state});return{state,result};}
  catch(e){if(e instanceof DatabaseError&&e.code==='revision_conflict'&&attempt<3)continue;throw e;}
 }
 throw new Error('The ledger is busy; retry shortly.');
}

import 'server-only';
import { cookies } from 'next/headers';
import { getChatGPTUser } from '@/app/chatgpt-auth';
import { env,origin } from './env';
import { constantEqual,hmac } from './crypto';
export const SESSION_COOKIE='rentledger_session';
export async function isAuthenticated(){
 if(env('AUTH_MODE')==='sites'){const u=await getChatGPTUser();return !!u&&!!env('SITES_OWNER_EMAIL')&&u.email.toLowerCase()===env('SITES_OWNER_EMAIL').toLowerCase();}
 const secret=env('SESSION_SECRET');if(secret.length<32)return false;
 const token=(await cookies()).get(SESSION_COOKIE)?.value;if(!token)return false;const [expiry,nonce,sig]=token.split('.');if(!expiry||!nonce||!sig||Number(expiry)<Date.now()||Number(expiry)>Date.now()+13*3600000)return false;return constantEqual(await hmac(`${expiry}.${nonce}`,secret),sig);
}
export async function requireOwner(){if(!await isAuthenticated())throw new HttpError(401,'Please sign in.');}
export class HttpError extends Error{constructor(public status:number,message:string){super(message);}}
export function sameOrigin(req:Request){const requestOrigin=req.headers.get('origin');if(!requestOrigin||requestOrigin!==origin())throw new HttpError(403,'This request must come from your application.');const site=req.headers.get('sec-fetch-site');if(site&&site!=='same-origin'&&site!=='none')throw new HttpError(403,'Cross-site requests are not allowed.');}
export async function jsonBody(req:Request,maxBytes=100000){if(!req.headers.get('content-type')?.includes('application/json'))throw new HttpError(415,'JSON is required.');const text=await limitedBody(req,maxBytes);try{return JSON.parse(text)}catch{throw new HttpError(400,'Invalid JSON.');}}
export async function limitedBody(req:Request,maxBytes:number){const reader=req.body?.getReader();if(!reader)return '';let count=0;const chunks:Uint8Array[]=[];while(true){const {done,value}=await reader.read();if(done)break;count+=value.byteLength;if(count>maxBytes){await reader.cancel();throw new HttpError(413,'Request is too large.');}chunks.push(value);}const bytes=new Uint8Array(count);let p=0;for(const x of chunks){bytes.set(x,p);p+=x.byteLength;}return new TextDecoder().decode(bytes);}

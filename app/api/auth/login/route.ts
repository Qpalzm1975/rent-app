import { cookies } from 'next/headers';
import { z } from 'zod';
import { env } from '@/lib/server/env';
import { jsonBody,sameOrigin,SESSION_COOKIE } from '@/lib/server/auth';
import { rpc } from '@/lib/server/database';
import { hmac,passwordMatches,sha256 } from '@/lib/server/crypto';
import { json,failure } from '@/lib/server/http';
export async function POST(req:Request){try{
 sameOrigin(req);if(env('AUTH_MODE')==='sites')return json({error:'Use ChatGPT sign-in.'},400);
 if(env('SESSION_SECRET').length<32||!env('OWNER_PASSWORD_HASH'))return json({error:'Configure authentication on the server first.'},503);
 const {password}=z.object({password:z.string().min(1).max(512)}).parse(await jsonBody(req,2000));
 // Global owner bucket cannot be bypassed by spoofing IP headers.
 const bucket=await sha256('rentledger-owner-login');if(!await rpc<boolean>('login_allowed',{p_bucket:bucket}))return json({error:'Too many attempts. Wait 15 minutes before trying again.'},429);
 if(!await passwordMatches(password,env('OWNER_PASSWORD_HASH')))return json({error:'Incorrect password.'},401);
 const payload=`${Date.now()+12*3600000}.${crypto.randomUUID()}`;const token=`${payload}.${await hmac(payload,env('SESSION_SECRET'))}`;
 (await cookies()).set(SESSION_COOKIE,token,{httpOnly:true,secure:process.env.NODE_ENV==='production',sameSite:'strict',path:'/',maxAge:12*3600});return json({ok:true});
 }catch(e){return failure(e);}}

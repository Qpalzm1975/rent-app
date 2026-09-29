import { cookies } from 'next/headers';
import { sameOrigin,SESSION_COOKIE } from '@/lib/server/auth';
import { json,failure } from '@/lib/server/http';
export async function POST(req:Request){try{sameOrigin(req);(await cookies()).delete(SESSION_COOKIE);return json({ok:true});}catch(e){return failure(e);}}

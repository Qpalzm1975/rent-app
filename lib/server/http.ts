import { HttpError } from './auth';
import { DatabaseError } from './database';
import { ZodError } from 'zod';
export function json(value:unknown,status=200){return Response.json(value,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'same-origin'}});}
export function failure(error:unknown){if(error instanceof HttpError)return json({error:error.message},error.status);if(error instanceof ZodError)return json({error:error.issues.map(x=>`${x.path.join('.')}: ${x.message}`).join('; ')},400);if(error instanceof DatabaseError)return json({error:error.message},error.code==='revision_conflict'?409:503);return json({error:error instanceof Error?error.message:'The operation could not be completed.'},400);}

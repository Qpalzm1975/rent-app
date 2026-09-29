import { requireOwner } from '@/lib/server/auth';
import { snapshot } from '@/lib/server/database';
import { json,failure } from '@/lib/server/http';
export const dynamic='force-dynamic';
export async function GET(){try{await requireOwner();return json(await snapshot());}catch(e){return failure(e);}}

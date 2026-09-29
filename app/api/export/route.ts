import { requireOwner } from '@/lib/server/auth';
import { snapshot } from '@/lib/server/database';
import { failure } from '@/lib/server/http';
import { csv,exportRows } from '@/lib/engine/export';
import { validDate } from '@/lib/engine/dates';
export const dynamic='force-dynamic';
export async function GET(req:Request){try{await requireOwner();const p=new URL(req.url).searchParams,from=p.get('from')??'',to=p.get('to')??'';if(!validDate(from)||!validDate(to)||from>to)throw new Error('Select a valid date range.');const rows=exportRows(await snapshot(),{from,to,propertyId:p.get('property')||undefined,tenantId:p.get('tenant')||undefined,category:p.get('category')||undefined});return new Response(csv(rows),{headers:{'Content-Type':'text/csv; charset=utf-8','Content-Disposition':`attachment; filename="rentledger-${from}-${to}.csv"`,'Cache-Control':'no-store'}});}catch(e){return failure(e);}}

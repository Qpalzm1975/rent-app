import { hmac,constantEqual } from '../server/crypto';
export async function verifyWebhook(headers:Headers,raw:string,secrets:string[],now=new Date()):Promise<boolean>{
 const v2=headers.get('redbark-signature');let timestamp:string|undefined,signatures:string[]=[];
 if(v2){const fields=v2.split(',').map(x=>x.trim());const times=fields.filter(x=>x.startsWith('t='));if(times.length!==1)return false;timestamp=times[0].slice(2);signatures=fields.filter(x=>x.startsWith('v1=')).map(x=>x.slice(3));}
 else{timestamp=headers.get('x-redbark-timestamp')??undefined;const h=headers.get('x-redbark-signature')??'';if(h.startsWith('sha256='))signatures=[h.slice(7)];}
 if(!timestamp||!/^\d{10}$/.test(timestamp)||Math.abs(now.getTime()/1000-Number(timestamp))>300||!signatures.length)return false;
 for(const secret of secrets.filter(Boolean)){const expected=await hmac(`${timestamp}.${raw}`,secret);if(signatures.some(sig=>/^[a-f0-9]{64}$/.test(sig)&&constantEqual(sig,expected)))return true;}
 return false;
}

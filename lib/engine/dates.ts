export function validDate(s:string):boolean {return /^\d{4}-\d{2}-\d{2}$/.test(s)&&!Number.isNaN(Date.parse(s+'T12:00:00Z'))&&new Date(s+'T12:00:00Z').toISOString().slice(0,10)===s;}
export function addDays(date:string,n:number):string {if(!validDate(date))throw new Error('Invalid calendar date.');const d=new Date(date+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+n);return d.toISOString().slice(0,10);}
export function daysBetween(a:string,b:string):number {return Math.round((Date.parse(b+'T12:00:00Z')-Date.parse(a+'T12:00:00Z'))/86400000);}
export function dayOfWeek(d:string):number{return new Date(d+'T12:00:00Z').getUTCDay();}
export function localDate(now:Date,timezone:string):string {const parts=new Intl.DateTimeFormat('en-CA',{timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(now);const p=(t:string)=>parts.find(x=>x.type===t)!.value;return `${p('year')}-${p('month')}-${p('day')}`;}
export function weekStart(date:string,weekday=1):string {return addDays(date,-((dayOfWeek(date)-weekday+7)%7));}
export function dateLabel(date:string,opts:Intl.DateTimeFormatOptions={day:'numeric',month:'short'}):string {return new Intl.DateTimeFormat('en-AU',{...opts,timeZone:'UTC'}).format(new Date(date.slice(0,10)+'T12:00:00Z'));}
export function rangeFor(preset:string,today:string):{from:string;to:string}{
 const y=Number(today.slice(0,4)),m=Number(today.slice(5,7));
 if(preset==='week'){const from=weekStart(today);return {from,to:addDays(from,6)};}
 if(preset==='quarter'){const q=Math.floor((m-1)/3)*3+1,from=`${y}-${String(q).padStart(2,'0')}-01`;return {from,to:addDays(q===10?`${y+1}-01-01`:`${y}-${String(q+3).padStart(2,'0')}-01`,-1)};}
 if(preset==='year'){const fy=m>=7?y:y-1;return{from:`${fy}-07-01`,to:`${fy+1}-06-30`};}
 const from=today.slice(0,7)+'-01';return{from,to:addDays(m===12?`${y+1}-01-01`:`${y}-${String(m+1).padStart(2,'0')}-01`,-1)};
}

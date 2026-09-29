import type { Cents } from './types';
export const MAX_CENTS=1_000_000_000_000;
export function cents(value:string):Cents {
 const m=/^(-?)(\d{1,10})(?:\.(\d{1,2}))?$/.exec(value.trim());
 if(!m)throw new Error('Enter an amount with at most two decimal places.');
 const n=(m[1]? -1:1)*(Number(m[2])*100+Number((m[3]??'').padEnd(2,'0')));
 return checked(n);
}
export function checked(n:number):Cents {if(!Number.isSafeInteger(n)||Math.abs(n)>MAX_CENTS)throw new Error('Money amount is out of range.');return n;}
export function sum(values:number[]):Cents{return values.reduce((a,b)=>checked(a+b),0);}
export function decimal(n:Cents):string {checked(n);return `${n<0?'-':''}${Math.floor(Math.abs(n)/100)}.${String(Math.abs(n)%100).padStart(2,'0')}`;}
export function money(n:Cents):string {const v=decimal(n),[whole,fraction]=v.split('.');return `${n<0?'-':''}$${whole.replace('-','').replace(/\B(?=(\d{3})+(?!\d))/g,',')}${fraction==='00'?'':'.'+fraction}`;}
// Stable participant order receives the remainder cents; vacant/owner units
// receive the final shares. No floating-point division is used for money.
export function splitBill(total:Cents,tenantCount:number,divider=tenantCount):{shares:Cents[];owner:Cents}{
 checked(total);if(total<=0||!Number.isInteger(divider)||divider<tenantCount||divider<1||divider>100||tenantCount<0)throw new Error('The divider must be at least the number of selected tenants.');
 const base=Math.floor(total/divider),remainder=total%divider;
 const shares=Array.from({length:tenantCount},(_,i)=>base+(i<remainder?1:0));
 return {shares,owner:checked(total-sum(shares))};
}

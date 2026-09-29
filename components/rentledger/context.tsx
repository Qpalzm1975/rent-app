'use client';
import {createContext,useContext} from 'react';
import type {State} from '@/lib/engine/types';
export type Screen='dashboard'|'tenants'|'rent'|'bills'|'transactions'|'reports'|'settings';
export interface AppContext {state:State;now:Date;demo:boolean;busy:boolean;property:string;setProperty:(id:string)=>void;go:(page:Screen,filter?:string)=>void;run:(action:unknown)=>Promise<boolean>;request:(path:string,body?:unknown)=>Promise<unknown>;reload:()=>Promise<void>;filter:string;setFilter:(value:string)=>void;openTenant:(id:string)=>void;openTransaction:(id:string)=>void;openForm:(kind:string,id?:string)=>void;}
export const LedgerContext=createContext<AppContext|null>(null);
export const useLedger=()=>{const c=useContext(LedgerContext);if(!c)throw new Error('Ledger context required');return c;};

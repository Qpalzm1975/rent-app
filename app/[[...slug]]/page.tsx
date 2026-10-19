import {notFound} from 'next/navigation';
import RentledgerApp from '@/components/rentledger/app';
import {Login,Provision} from '@/components/rentledger/login';
import {configuration,env} from '@/lib/server/env';
import {isAuthenticated} from '@/lib/server/auth';
import {snapshot} from '@/lib/server/database';
import {demoState,DEMO_NOW} from '@/lib/engine/demo';
import type {Screen} from '@/components/rentledger/context';
export const dynamic='force-dynamic';
export default async function Page({params,searchParams}:{params:Promise<{slug?:string[]}>;searchParams:Promise<Record<string,string|string[]|undefined>>}){const {slug=[]}=await params;const query=await searchParams;const filter=typeof query.filter==='string'?query.filter.slice(0,100):'';const demo=slug[0]==='demo';const route=slug[demo?1:0]??'dashboard';if(!['dashboard','tenants','rent','bills','transactions','reports','settings'].includes(route)||slug.length>(demo?2:1))notFound();const config=configuration();if(demo)return <RentledgerApp initialState={demoState()} initialPage={route as Screen} initialFilter={filter} demo clock={DEMO_NOW} config={config}/>;if(!config.database||!config.authentication)return <Provision config={config}/>;if(!await isAuthenticated())return <Login sites={env('AUTH_MODE')==='sites'}/>;try{const state=await snapshot();return <RentledgerApp initialState={state} initialPage={!state.properties.length?'settings':route as Screen} initialFilter={filter} clock={new Date().toISOString()} config={config}/>;}catch{return <Provision config={config} error="The database could not be read. Check the server credentials and apply the included migration."/>;}}

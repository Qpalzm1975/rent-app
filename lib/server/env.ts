import 'server-only';
export function env(name:string){return process.env[name]?.trim()??'';}
export function configuration(){return {database:!!(env('SUPABASE_URL')&&env('SUPABASE_SERVICE_ROLE_KEY')),authentication:env('AUTH_MODE')==='sites'||!!(env('OWNER_PASSWORD_HASH')&&env('SESSION_SECRET')),bank:!!env('REDBARK_API_KEY'),webhook:!!env('REDBARK_WEBHOOK_SECRET'),scheduler:!!env('CRON_SECRET'),origin:!!env('APP_ORIGIN')};}
export function origin(){const value=env('APP_ORIGIN');if(!value)throw new Error('Set APP_ORIGIN to your HTTPS application address.');const u=new URL(value);if(u.protocol!=='https:'&&process.env.NODE_ENV==='production')throw new Error('Production requires HTTPS.');return u.origin;}

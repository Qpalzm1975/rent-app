import type { Metadata } from 'next';
import './globals.css';
export const metadata:Metadata={title:'Rentledger · Your property, in balance',description:'Private rental property accounts, live bank reconciliation and tenant ledgers.',robots:{index:false,follow:false},icons:{icon:'/favicon.svg'}};
export default function RootLayout({children}:{children:React.ReactNode}){return <html lang="en-AU"><body>{children}</body></html>}

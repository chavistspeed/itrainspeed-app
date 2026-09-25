import Image from 'next/image';import Nav from './Nav'
export default function AppShell({children,title='iTrainSpeed'}){return <><header><Image src="/logo.png" alt="iTrainSpeed" width={150} height={70} style={{objectFit:'contain'}}/><span>{title}</span></header><main>{children}</main><Nav/></>}

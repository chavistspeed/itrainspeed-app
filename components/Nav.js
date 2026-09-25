'use client'
import Link from 'next/link'; import {usePathname} from 'next/navigation'
export default function Nav(){const p=usePathname();const items=[['/dashboard','Home'],['/booking','Book'],['/athletes','Athletes'],['/plans','Plans'],['/coach','Coach']];return <nav className="bottom">{items.map(([h,l])=><Link className={p===h?'active':''} key={h} href={h}>{l}</Link>)}</nav>}

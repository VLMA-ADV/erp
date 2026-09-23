'use client'

import Link from 'next/link'
import type { LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils/cn'

interface SidebarItemProps {
  href: string
  label: string
  active?: boolean
  /** Ícone opcional à esquerda do rótulo (só a Central de chamados usa, por ora). */
  icon?: LucideIcon
}

export default function SidebarItem({ href, label, active, icon: Icon }: SidebarItemProps) {
  return (
    <Link
      href={href}
      className={cn(
        'flex items-center px-4 py-2 text-sm font-medium rounded-md transition-colors',
        active
          ? 'bg-primary text-primary-foreground'
          : 'text-ink-mute hover:bg-canvas hover:text-ink'
      )}
    >
      {Icon ? <Icon className="mr-2 h-4 w-4 shrink-0" aria-hidden="true" /> : null}
      {label}
    </Link>
  )
}

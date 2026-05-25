'use client'

import Link from 'next/link'
import { cn } from '@/lib/utils/cn'

interface SidebarItemProps {
  href: string
  label: string
  active?: boolean
}

export default function SidebarItem({ href, label, active }: SidebarItemProps) {
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
      {label}
    </Link>
  )
}

import * as React from 'react'
import { cn } from '@/lib/utils/cn'

const Sidebar = React.forwardRef<HTMLElement, React.HTMLAttributes<HTMLElement>>(({ className, ...props }, ref) => (
  <aside ref={ref} className={cn('sticky top-0 flex h-screen min-h-0 w-64 flex-col overflow-hidden border-r bg-gray-50 p-4', className)} {...props} />
))
Sidebar.displayName = 'Sidebar'

const SidebarHeader = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(({ className, ...props }, ref) => (
  <div ref={ref} className={cn('mb-6 shrink-0', className)} {...props} />
))
SidebarHeader.displayName = 'SidebarHeader'

const SidebarContent = React.forwardRef<HTMLElement, React.HTMLAttributes<HTMLElement>>(({ className, ...props }, ref) => (
  <nav ref={ref} className={cn('min-h-0 flex-1 space-y-1 overflow-y-auto pr-1', className)} {...props} />
))
SidebarContent.displayName = 'SidebarContent'

const SidebarFooter = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(({ className, ...props }, ref) => (
  <div ref={ref} className={cn('mt-4 shrink-0 border-t pt-4', className)} {...props} />
))
SidebarFooter.displayName = 'SidebarFooter'

export { Sidebar, SidebarHeader, SidebarContent, SidebarFooter }

import * as React from 'react'
import { cn } from '@/lib/utils/cn'

interface BadgeProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: 'default' | 'soft'
}

function Badge({ className, variant = 'default', ...props }: BadgeProps) {
  return (
    <div
      className={cn(
        'inline-flex items-center rounded-pill px-2.5 py-0.5 text-[10px] font-medium uppercase tracking-wider transition-colors',
        variant === 'default' && 'border border-hairline',
        variant === 'soft' && 'border-0 bg-primary-soft-bg text-primary-soft-fg',
        className,
      )}
      {...props}
    />
  )
}

export { Badge }

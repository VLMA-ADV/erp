import * as React from 'react'
import { cn } from '@/lib/utils/cn'

function Badge({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        'inline-flex items-center rounded-pill border border-hairline px-2.5 py-0.5 text-[10px] font-medium uppercase tracking-wider transition-colors',
        className,
      )}
      {...props}
    />
  )
}

export { Badge }

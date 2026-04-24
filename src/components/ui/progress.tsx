'use client'

import { cn } from '@/lib/utils/cn'

interface ProgressProps {
  value: number // 0-100
  className?: string
  showLabel?: boolean
}

export function Progress({ value, className, showLabel = true }: ProgressProps) {
  const clampedValue = Math.min(100, Math.max(0, value))

  return (
    <div className={cn('w-full', className)}>
      <div className="relative h-2 w-full overflow-hidden rounded-full bg-gray-200">
        <div
          className="h-full bg-primary transition-all duration-300 ease-out"
          style={{ width: `${clampedValue}%` }}
        />
      </div>
      {showLabel && (
        <div className="mt-1 text-center text-xs text-gray-600">
          {Math.round(clampedValue)}%
        </div>
      )}
    </div>
  )
}

interface ProgressWithStepsProps {
  currentStep: number
  totalSteps: number
  stepLabels?: string[]
  className?: string
}

export function ProgressWithSteps({
  currentStep,
  totalSteps,
  stepLabels,
  className,
}: ProgressWithStepsProps) {
  const percentage = (currentStep / totalSteps) * 100

  return (
    <div className={cn('w-full space-y-2', className)}>
      <Progress value={percentage} showLabel={true} />
      {stepLabels && stepLabels.length > 0 && (
        <div className="flex justify-between text-xs text-gray-500">
          {stepLabels.map((label, index) => (
            <span
              key={index}
              className={cn(
                index < currentStep && 'text-primary font-medium',
                index === currentStep && 'text-primary font-semibold'
              )}
            >
              {label}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

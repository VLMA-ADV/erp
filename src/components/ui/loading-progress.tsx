'use client'

import { useState, useEffect } from 'react'
import { Progress } from './progress'
import { cn } from '@/lib/utils/cn'

interface LoadingProgressProps {
  isLoading: boolean
  message?: string
  className?: string
}

/**
 * Componente de loading com barra de progresso animada
 * Simula progresso de 0% a 90% enquanto carrega
 */
export function LoadingProgress({ isLoading, message = 'Carregando...', className }: LoadingProgressProps) {
  const [progress, setProgress] = useState(0)

  useEffect(() => {
    if (!isLoading) {
      setProgress(0)
      return
    }

    // Simular progresso de 0% a 90%
    let currentProgress = 0
    const interval = setInterval(() => {
      currentProgress += Math.random() * 15
      if (currentProgress > 90) {
        currentProgress = 90
      }
      setProgress(currentProgress)
    }, 200)

    return () => clearInterval(interval)
  }, [isLoading])

  if (!isLoading) {
    return null
  }

  return (
    <div className={`flex flex-col items-center justify-center space-y-4 p-8 ${className}`}>
      <div className="w-full max-w-md">
        <Progress value={progress} showLabel={true} />
      </div>
      <p className="text-sm text-gray-600">{message}</p>
    </div>
  )
}

interface LoadingProgressWithStepsProps {
  isLoading: boolean
  currentStep: number
  totalSteps: number
  stepLabels: string[]
  message?: string
  className?: string
}

/**
 * Componente de loading com barra de progresso e etapas
 */
export function LoadingProgressWithSteps({
  isLoading,
  currentStep,
  totalSteps,
  stepLabels,
  message,
  className,
}: LoadingProgressWithStepsProps) {
  const [progress, setProgress] = useState(0)

  useEffect(() => {
    if (!isLoading) {
      setProgress(0)
      return
    }

    // Calcular progresso baseado na etapa atual
    const baseProgress = (currentStep / totalSteps) * 100
    const stepProgress = (1 / totalSteps) * 100 * 0.5 // 50% da etapa atual

    setProgress(Math.min(95, baseProgress + stepProgress))
  }, [isLoading, currentStep, totalSteps])

  if (!isLoading) {
    return null
  }

  return (
    <div className={`flex flex-col items-center justify-center space-y-4 p-8 ${className}`}>
      <div className="w-full max-w-md">
        <Progress value={progress} showLabel={true} />
      </div>
      {stepLabels.length > 0 && (
        <div className="w-full max-w-md">
          <div className="flex justify-between text-xs text-gray-500 mb-2">
            {stepLabels.map((label, index) => (
              <span
                key={index}
                className={cn(
                  index < currentStep && 'text-primary font-medium',
                  index === currentStep && 'text-primary font-semibold',
                  index > currentStep && 'text-gray-400'
                )}
              >
                {label}
              </span>
            ))}
          </div>
        </div>
      )}
      {message && <p className="text-sm text-gray-600">{message}</p>}
    </div>
  )
}

'use client'

import { type ReactNode } from 'react'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'

export interface SectionTab {
  value: string
  label: string
  content: ReactNode
}

/**
 * Abas de seção reutilizáveis para telas densas (dashboard × lista, etc).
 * A aba inativa desmonta (Tabs base) — bom para performance; estado de formulário,
 * se houver, deve viver no componente pai.
 */
export function SectionTabs({
  tabs,
  defaultValue,
  className,
}: {
  tabs: SectionTab[]
  defaultValue?: string
  className?: string
}) {
  return (
    <Tabs defaultValue={defaultValue || tabs[0]?.value} className={className}>
      <TabsList>
        {tabs.map((t) => (
          <TabsTrigger key={t.value} value={t.value}>
            {t.label}
          </TabsTrigger>
        ))}
      </TabsList>
      {tabs.map((t) => (
        <TabsContent key={t.value} value={t.value} className="mt-4">
          {t.content}
        </TabsContent>
      ))}
    </Tabs>
  )
}

export default SectionTabs

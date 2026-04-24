import type { Metadata } from "next"
import "./globals.css"

export const metadata: Metadata = {
  title: "ERP-VLMA",
  description: "Sistema ERP para escritório de advocacia",
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="pt-BR">
      <body className="antialiased">{children}</body>
    </html>
  )
}

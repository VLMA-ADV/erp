import type { Metadata } from "next"
import { Inter } from "next/font/google"
import "./globals.css"
import { ToastProvider } from "@/components/ui/use-toast"
import dynamic from "next/dynamic"

const inter = Inter({ subsets: ["latin"] })

const ToastContainerClient = dynamic(
  () => import("@/components/ui/toast-container-client").then((mod) => ({ default: mod.ToastContainerClient })),
  { ssr: false }
)

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
      <body className={inter.className}>
        <ToastProvider>
          {children}
          <ToastContainerClient />
        </ToastProvider>
      </body>
    </html>
  )
}

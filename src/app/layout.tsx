import type { Metadata } from "next"
import { Inter, Darker_Grotesque } from "next/font/google"
import "./globals.css"

const inter = Inter({
  subsets: ["latin"],
  weight: ["300", "400", "500", "600"],
  variable: "--font-inter",
  display: "swap",
})

// Tipografia de marca VLMA (títulos/display)
const darkerGrotesque = Darker_Grotesque({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800", "900"],
  variable: "--font-display",
  display: "swap",
})

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
    <html lang="pt-BR" className={`${inter.variable} ${darkerGrotesque.variable}`}>
      <body className="font-sans antialiased">{children}</body>
    </html>
  )
}

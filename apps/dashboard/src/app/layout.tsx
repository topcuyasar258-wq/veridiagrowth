import type { Metadata } from "next"
import Link from "next/link"

import "./globals.css"

export const metadata: Metadata = {
  title: "Veridia Lead Layer",
  description: "Customer lead management dashboard for Veridia Lead Layer.",
}

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <header className="nav">
          <strong>Veridia</strong>
          <nav className="nav-links" aria-label="Primary">
            <Link href="/dashboard">Genel Bakış</Link>
            <Link href="/dashboard/leads">Talepler</Link>
            <Link href="/dashboard/sites">Siteler</Link>
          </nav>
        </header>
        {children}
      </body>
    </html>
  )
}

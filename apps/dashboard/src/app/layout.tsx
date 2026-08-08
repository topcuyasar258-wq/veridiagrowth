import type { Metadata } from "next"
import Link from "next/link"

import "./globals.css"

export const metadata: Metadata = {
  title: "Veridia Lead Layer",
  description: "Tenant foundation for Veridia Lead Layer.",
}

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <header className="nav">
          <strong>Veridia Lead Layer</strong>
          <nav className="nav-links" aria-label="Primary">
            <Link href="/dashboard">Dashboard</Link>
            <Link href="/dashboard/sites">Sites</Link>
          </nav>
        </header>
        {children}
      </body>
    </html>
  )
}

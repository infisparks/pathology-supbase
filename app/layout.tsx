// app/layout.tsx
'use client'

import './globals.css'
import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import AuthGuard from '@/components/AuthGuard'
import Sidebar from '@/components/Sidebar'  // ← import your Sidebar

const inter = Inter({ subsets: ['latin'] })



export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body className={inter.className}>
        <AuthGuard>
          <div className="flex h-screen">
            <Sidebar />

            {/* main content area */}
            <main className="flex-1 overflow-auto bg-gray-50 p-4">
              {children}
            </main>
          </div>
        </AuthGuard>
      </body>
    </html>
  )
}

'use client'

import { useEffect, useState } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import { getCurrentUser, onAuthStateChange, type AuthUser } from '@/lib/auth'
import { useUserRole } from '@/hooks/useUserRole'

const roleAccessMap: Record<string, string[]> = {
  '/dashboard': ['admin', 'technician', 'phlebo'],
  '/patient-entry': ['admin', 'technician'],
  '/patients': ['admin'],
  '/deleted': ['admin'],
  '/blood-tests': ['admin'],
  '/packages': ['admin'],
  '/settings': ['admin', 'technician', 'phlebo'],
}

interface AuthGuardProps {
  children: React.ReactNode
}

export default function AuthGuard({ children }: AuthGuardProps) {
  const [user, setUser] = useState<AuthUser | null>(null)
  const [loading, setLoading] = useState(true)
  const router = useRouter()
  const pathname = usePathname()
  const { role, loading: roleLoading } = useUserRole()

  useEffect(() => {
    getCurrentUser().then((user) => {
      setUser(user)
      setLoading(false)
      if (!user && pathname !== '/login') {
        router.push('/login')
      } else if (user && pathname === '/login') {
        router.push('/dashboard')
      }
    })
    const { data: { subscription } } = onAuthStateChange((user) => {
      setUser(user)
      if (!user && pathname !== '/login') {
        router.push('/login')
      } else if (user && pathname === '/login') {
        router.push('/dashboard')
      }
    })
    return () => subscription.unsubscribe()
  }, [router, pathname])

  useEffect(() => {
    if (loading || roleLoading || !user || pathname === '/login') return
    // Check allowed roles for current path
    const allowedRoles = roleAccessMap[pathname]
    if (allowedRoles && role && !allowedRoles.includes(role)) {
      router.push('/dashboard')
    }
  }, [role, roleLoading, user, pathname, router, loading])

  if (loading || roleLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-blue-600"></div>
      </div>
    )
  }

  if (pathname === '/login') {
    return <>{children}</>
  }

  if (!user) {
    return null
  }

  return <>{children}</>
}

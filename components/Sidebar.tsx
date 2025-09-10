'use client'

import { useState, useEffect } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import { 
  Home, UserPlus, Users, FlaskConical, Package, Settings, LogOut, Stethoscope, ChevronLeft, ChevronRight, Clock
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { signOut } from '@/lib/auth'
import { cn } from '@/lib/utils'
import { useUserRole } from '@/hooks/useUserRole'
import { supabase } from '@/lib/supabase'
import Link from 'next/link'

const sidebarItems = [
  { icon: Home, label: 'Dashboard', href: '/dashboard', roles: ['admin', 'technician', 'phlebo'] },
  { icon: UserPlus, label: 'Patient Entry', href: '/patient-entry', roles: ['admin', 'technician'] },
  // The correct icon for X-ray items is Stethoscope
  { icon: Stethoscope, label: 'X-ray Entry', href: '/x-ray', roles: ['admin', 'xray'] },
  { icon: Stethoscope, label: 'X-ray Dashboard', href: '/x-rayDashboard', roles: ['admin', 'xray'] },
  { icon: Users, label: 'Patients', href: '/patients', roles: ['admin'] },
  { icon: Clock, label: 'Turn Around Time', href: '/turnAroundTime', roles: ['admin'] },
  { icon: Users, label: 'Deleted Entry', href: '/deleted', roles: ['admin'] },
  { icon: FlaskConical, label: 'Billing', href: '/billing', roles: ['admin'] },
  { icon: FlaskConical, label: 'Blood Tests', href: '/blood-tests', roles: ['admin'] },
  { icon: Package, label: 'Packages', href: '/packages', roles: ['admin'] },
  { icon: Settings, label: 'Settings', href: '/settings', roles: ['admin', 'technician', 'phlebo'] },
]

export default function Sidebar() {
  const { role, loading, error } = useUserRole()
  const pathname = usePathname()
  const router = useRouter()
  const [isCollapsed, setIsCollapsed] = useState(true)
  const [email, setEmail] = useState<string | null>(null)

  useEffect(() => {
    supabase.auth.getUser().then(({ data, error }) => {
      if (data.user?.email) {
        setEmail(data.user.email)
      }
    })
  }, [])

  const handleSignOut = async () => {
    try {
      await signOut()
      router.push('/login')
    } catch (error) {
      console.error('Sign out error:', error)
    }
  }

  if (loading) {
    return (
      <div className={cn(
        "h-screen bg-white flex items-center justify-center transition-all duration-300",
        isCollapsed ? "w-16" : "w-64"
      )}>
        <span className="text-gray-500 animate-pulse">Loading menu...</span>
      </div>
    )
  }

  if (!role) {
    return (
      <div className={cn(
        "h-screen bg-white flex flex-col items-center justify-center transition-all duration-300",
        isCollapsed ? "w-16" : "w-64"
      )}>
        <div className="text-red-500 text-center mb-4">
          <p className="font-semibold">{error || 'Role not found'}</p>
          <p className="text-gray-600 text-sm mt-2">
            Your account does not have an assigned role.<br />
            Please contact your administrator.<br />
            Or try refreshing or signing out below.
          </p>
        </div>
        <div className="flex space-x-2">
          <Button
            variant="outline"
            className="text-blue-600 border-blue-500 hover:bg-blue-50"
            onClick={() => window.location.reload()}
          >
            Retry
          </Button>
          <Button
            variant="ghost"
            className="text-red-600 hover:text-red-700"
            onClick={handleSignOut}
          >
            <LogOut className="w-5 h-5 mr-2" />
            Sign Out
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className={cn(
      "h-screen bg-white shadow-lg flex flex-col transition-all duration-300",
      isCollapsed ? "w-16" : "w-64"
    )}>
      {/* Header */}
      <div className="p-4 border-b border-gray-200">
        <div className="flex items-center justify-between">
          {!isCollapsed && (
            <div className="flex items-center space-x-3">
              <div className="w-10 h-10 bg-blue-600 rounded-lg flex items-center justify-center">
                <Stethoscope className="w-6 h-6 text-white" />
              </div>
              <div className="flex-1">
                <h1 className="font-bold text-lg text-gray-900">INFICARE</h1>
                <p className="text-xs text-gray-500">Pathology System</p>
                {email && (
                  <p className="mt-1 text-xs text-gray-600 truncate">{email}</p>
                )}
              </div>
            </div>
          )}
          {isCollapsed && (
            <div className="w-10 h-10 bg-blue-600 rounded-lg flex items-center justify-center mx-auto">
              <Stethoscope className="w-6 h-6 text-white" />
            </div>
          )}
          <Button
            variant="ghost"
            size="sm"
            className="h-8 w-8 p-0 hover:bg-gray-100"
            onClick={() => setIsCollapsed(!isCollapsed)}
          >
            {isCollapsed ? (
              <ChevronRight className="w-4 h-4" />
            ) : (
              <ChevronLeft className="w-4 h-4" />
            )}
          </Button>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 p-4 overflow-y-auto">
        <ul className="space-y-2">
          {sidebarItems
            .filter(item => item.roles.includes(role))
            .map((item) => {
              const Icon = item.icon
              const isActive = pathname === item.href
              
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    className={cn(
                      "flex items-center space-x-3 px-4 py-3 rounded-lg text-sm font-medium transition-colors",
                      isActive
                        ? "bg-blue-50 text-blue-700 border-r-2 border-blue-700"
                        : "text-gray-600 hover:bg-gray-50 hover:text-gray-900"
                    )}
                    title={isCollapsed ? item.label : undefined}
                  >
                    <Icon className="w-5 h-5 flex-shrink-0" />
                    {!isCollapsed && <span>{item.label}</span>}
                  </Link>
                </li>
              )
            })}
        </ul>
      </nav>

      {/* Footer */}
      <div className="p-4 border-t border-gray-200">
        <Button
          variant="ghost"
          className={cn(
            "w-full justify-start text-red-600 hover:text-red-700 hover:bg-red-50",
            isCollapsed && "justify-center"
          )}
          onClick={handleSignOut}
          title={isCollapsed ? "Sign Out" : undefined}
        >
          <LogOut className="w-5 h-5 flex-shrink-0" />
          {!isCollapsed && <span className="ml-3">Sign Out</span>}
        </Button>
      </div>
    </div>
  )
}
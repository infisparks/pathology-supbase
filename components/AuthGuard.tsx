// @/components/AuthGuard.tsx
'use client'

import { useEffect, useState, useRef } from 'react'
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
  '/x-ray': ['admin', 'xray'],
  '/x-rayDashboard': ['admin', 'xray'],
  '/x-ray/[registrationId]': ['admin', 'xray'],
  '/billing': ['admin'],
  '/blood-values': ['admin'],
  '/download-report': ['admin'],
  '/edit-patient': ['admin'],
  // Add other routes as needed
}

interface AuthGuardProps {
  children: React.ReactNode
}

export default function AuthGuard({ children }: AuthGuardProps) {
  const [user, setUser] = useState<AuthUser | null>(null)
  const [loadingAuth, setLoadingAuth] = useState(true) // Separate loading state for auth
  const router = useRouter()
  const pathname = usePathname()
  const { role, loading: roleLoading } = useUserRole()

  // Use a ref to track if an initial auth-based redirect has already occurred for the current session.
  const initialAuthRedirectHandled = useRef(false);

  // --- Effect 1: Handle initial authentication state and set up listener ---
  useEffect(() => {
    let isMounted = true; // Flag to track if the component is mounted

    // Listener for authentication state changes
    const { data: { subscription } } = onAuthStateChange((currentUser) => {
      if (!isMounted) return;

      setUser(currentUser);
      setLoadingAuth(false); // Auth loading is done once the listener provides a user state

      // Only attempt redirect if it hasn't been handled for this session init
      if (!initialAuthRedirectHandled.current) {
        if (!currentUser && pathname !== '/login') {
          router.replace('/login');
          initialAuthRedirectHandled.current = true;
        } else if (currentUser && pathname === '/login') {
          // Check user role and redirect accordingly
          if (role === 'xray') {
            router.replace('/x-rayDashboard');
          } else {
            router.replace('/dashboard');
          }
          initialAuthRedirectHandled.current = true;
        }
      }
    });

    // Initial check: get current user immediately on component mount
    getCurrentUser().then((currentUser) => {
      if (!isMounted) return;

      setUser(currentUser);
      setLoadingAuth(false);

      if (!initialAuthRedirectHandled.current) {
        if (!currentUser && pathname !== '/login') {
          router.replace('/login');
          initialAuthRedirectHandled.current = true;
        } else if (currentUser && pathname === '/login') {
          // Check user role and redirect accordingly
          if (role === 'xray') {
            router.replace('/x-rayDashboard');
          } else {
            router.replace('/dashboard');
          }
          initialAuthRedirectHandled.current = true;
        }
      }
    });

    return () => {
      isMounted = false;
      subscription.unsubscribe(); // Unsubscribe from auth listener on cleanup
    };
  }, [router, pathname, role]); // Added role dependency

  // --- Effect 2: Handle role-based access control and x-ray user redirects ---
  useEffect(() => {
    // Only proceed if authentication and role data are fully loaded, and user is present.
    // Also, don't redirect if we are on the login page as it's not role-restricted.
    if (loadingAuth || roleLoading || !user || pathname === '/login') {
      return;
    }

    // Special handling for x-ray users
    if (role === 'xray') {
      // X-ray users can only access x-ray related pages
      if (!pathname.startsWith('/x-ray') && pathname !== '/x-rayDashboard') {
        router.replace('/x-rayDashboard');
        return;
      }
    }

    const allowedRoles = roleAccessMap[pathname];

    // If the current path has defined roles and the current user's role is not among them
    if (allowedRoles && role && !allowedRoles.includes(role)) {
      // Redirect based on user role
      if (role === 'xray') {
        router.replace('/x-rayDashboard');
      } else {
        router.replace('/dashboard');
      }
    }
  }, [role, roleLoading, user, pathname, router, loadingAuth]); // Dependencies ensure this effect re-runs when these values change

  // --- Loading State Display ---
  if (loadingAuth || roleLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  // --- Conditional Rendering for children ---
  // If on login page, render children directly without further auth/role checks
  if (pathname === '/login') {
    return <>{children}</>;
  }

  // If we reach here and 'user' is null (after loadingAuth is false),
  // it means the user is not authenticated and they should have been redirected to /login.
  // So, we render nothing here to avoid a brief flash of content.
  if (!user) {
    return null;
  }

  // If user is authenticated and loading is complete, render children.
  // Role-based access has already been handled by Effect 2.
  return <>{children}</>;
}
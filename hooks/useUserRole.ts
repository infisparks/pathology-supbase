"use client"

import { useEffect, useState } from "react"
import { supabase } from "@/lib/supabase"
import { onAuthStateChange, type AuthUser } from "@/lib/auth" // Import onAuthStateChange and AuthUser type

export function useUserRole() {
  const [role, setRole] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    async function fetchUserRole(user: AuthUser | null = null) {
      setLoading(true)
      setError(null)

      let currentUser = user
      if (!currentUser) {
        // If user not provided (e.g., initial load), fetch it
        const {
          data: { user: fetchedUser },
          error: userError,
        } = await supabase.auth.getUser()
        if (userError || !fetchedUser) {
          if (!cancelled) {
            setRole(null)
            setError("No authenticated user")
            setLoading(false)
          }
          return
        }
        currentUser = fetchedUser as AuthUser
      }

      if (!currentUser) {
        // Double check if user is still null after fetching
        if (!cancelled) {
          setRole(null)
          setError("No authenticated user")
          setLoading(false)
        }
        return
      }

      // Query 'user' table by uid to get the role
      const { data, error: dbError } = await supabase.from("user").select("role").eq("uid", currentUser.id).single()

      if (!cancelled) {
        if (dbError || !data) {
          setRole(null)
          setError("Role not found or database error")
        } else {
          setRole(data.role)
          setError(null)
        }
        setLoading(false)
      }
    }

    // Initial fetch of the user role
    fetchUserRole()

    // Listen for authentication state changes [^2]
    const { data: authListener } = onAuthStateChange((user) => {
      if (user) {
        // User signed in, re-fetch role
        fetchUserRole(user)
      } else {
        // User signed out, clear role and error
        if (!cancelled) {
          setRole(null)
          setError(null)
          setLoading(false)
        }
      }
    })

    // Cleanup function for the effect
    return () => {
      cancelled = true
      authListener?.subscription?.unsubscribe() // Unsubscribe from the auth listener
    }
  }, []) // Empty dependency array means this effect runs once on mount, but the listener handles subsequent updates

  return { role, loading, error }
}

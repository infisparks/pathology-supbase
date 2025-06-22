import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'

export function useUserRole() {
  const [role, setRole] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    async function fetchUserRole() {
      setLoading(true)
      setError(null)
      // 1. Get current logged in user
      const { data: { user }, error: userError } = await supabase.auth.getUser()
      if (userError || !user) {
        if (!cancelled) {
          setRole(null)
          setError('No authenticated user')
          setLoading(false)
        }
        return
      }
      // 2. Query 'user' table by uid
      const { data, error } = await supabase
        .from('user')
        .select('role')
        .eq('uid', user.id)
        .single()
      if (!cancelled) {
        if (error || !data) {
          setRole(null)
          setError('Role not found')
        } else {
          setRole(data.role)
          setError(null)
        }
        setLoading(false)
      }
    }
    fetchUserRole()
    return () => { cancelled = true }
  }, [])

  return { role, loading, error }
}

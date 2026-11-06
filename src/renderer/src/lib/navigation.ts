// Navigation that only happens while the calling component is still on screen. Use it for "go to the
// result" after an awaited request: if the learner has already left the page, the late response must
// not drag them back.
import { useCallback, useEffect, useRef } from 'react'
import { useNavigate, type NavigateOptions, type To } from 'react-router-dom'

export function useSafeNavigate() {
  const navigate = useNavigate()
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])
  return useCallback(
    (to: To, options?: NavigateOptions) => {
      if (mounted.current) void navigate(to, options)
    },
    [navigate],
  )
}

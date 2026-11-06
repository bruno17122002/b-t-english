// Typed client for the IPC contract. `api('vocab:save', {...})` is fully typed from the contract and
// throws ApiError with a user-facing message (and optional hint such as 'ai-settings') on failure.
import { useCallback, useEffect, useRef, useState } from 'react'
import type { IpcError } from '@shared/ipc'
import type { Channel, In, Out } from '@modules/contract'

export class ApiError extends Error {
  readonly code: string
  readonly hint?: string
  constructor(err: IpcError) {
    super(err.message)
    this.name = 'ApiError'
    this.code = err.code
    this.hint = err.hint
  }
  /** True for AI errors that the learner fixes in AI Settings (missing / invalid key, quota, model). */
  get needsAiSettings(): boolean {
    return this.hint === 'ai-settings'
  }
}

export async function api<K extends Channel>(
  channel: K,
  ...args: undefined extends In<K> ? [In<K>?] : [In<K>]
): Promise<Out<K>> {
  if (!window.lq) throw new ApiError({ code: 'no_bridge', message: 'B&T English bridge is not available.' })
  const res = await window.lq.invoke(channel, args[0])
  if (!res.ok) throw new ApiError(res.error)
  return res.data as Out<K>
}

export const toApiError = (err: unknown): ApiError =>
  err instanceof ApiError
    ? err
    : new ApiError({ code: 'internal', message: err instanceof Error ? err.message : String(err) })

export interface Query<T> {
  data: T | undefined
  error: ApiError | null
  loading: boolean
  reload: () => Promise<void>
  setData: (updater: T | ((prev: T | undefined) => T)) => void
}

/**
 * Loads data from a channel and reloads when `deps` change. Stale responses are ignored.
 * Pass `null` as input to skip loading (e.g. while an id is unknown).
 */
export function useApi<K extends Channel>(channel: K, input: In<K> | null, deps: unknown[] = []): Query<Out<K>> {
  const [data, setDataState] = useState<Out<K> | undefined>(undefined)
  const [error, setError] = useState<ApiError | null>(null)
  const [loading, setLoading] = useState(input !== null)
  const seq = useRef(0)
  const inputRef = useRef(input)
  inputRef.current = input

  const reload = useCallback(async () => {
    if (inputRef.current === null) return
    const id = ++seq.current
    setLoading(true)
    try {
      const res = await (api as (c: K, i?: In<K>) => Promise<Out<K>>)(channel, inputRef.current)
      if (id === seq.current) {
        setDataState(res)
        setError(null)
      }
    } catch (err) {
      if (id === seq.current) setError(toApiError(err))
    } finally {
      if (id === seq.current) setLoading(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channel, ...deps])

  useEffect(() => {
    void reload()
  }, [reload])

  const setData = useCallback((updater: Out<K> | ((prev: Out<K> | undefined) => Out<K>)) => {
    setDataState((prev) =>
      typeof updater === 'function' ? (updater as (p: Out<K> | undefined) => Out<K>)(prev) : updater,
    )
  }, [])

  return { data, error, loading, reload, setData }
}

/**
 * Wraps an async action with pending/error state. Single-flight: while a run is pending, further calls
 * (double clicks, Enter spam, a shortcut plus a click) are ignored and resolve to undefined.
 */
export function useAction<A extends unknown[], R>(fn: (...args: A) => Promise<R>) {
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<ApiError | null>(null)
  const fnRef = useRef(fn)
  fnRef.current = fn
  const inFlight = useRef(false)
  const run = useCallback(async (...args: A): Promise<R | undefined> => {
    if (inFlight.current) return undefined
    inFlight.current = true
    setPending(true)
    setError(null)
    try {
      return await fnRef.current(...args)
    } catch (err) {
      setError(toApiError(err))
      return undefined
    } finally {
      inFlight.current = false
      setPending(false)
    }
  }, [])
  return { run, pending, error, clearError: () => setError(null) }
}

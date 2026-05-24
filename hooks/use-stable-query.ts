"use client"

/* eslint-disable @typescript-eslint/no-explicit-any */

import { useQuery } from "convex/react"
import { useEffect, useMemo, useState } from "react"

type CachedResult = {
  key: string
  value: any
}

export function useStableQuery(query: any, args?: any) {
  const result = useQuery(query, args)
  const shouldSkip = args === "skip"
  const cacheKey = useMemo(() => {
    if (shouldSkip) return "skip"
    return JSON.stringify(args ?? {})
  }, [args, shouldSkip])
  const [cached, setCached] = useState<CachedResult | null>(null)

  useEffect(() => {
    if (shouldSkip || result === undefined || result === null) return
    // The cache intentionally follows Convex's external query result so brief
    // auth refreshes do not replace mounted UI with loading placeholders.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setCached({ key: cacheKey, value: result })
  }, [cacheKey, result, shouldSkip])

  if (shouldSkip || result !== undefined) return result
  return cached?.key === cacheKey ? cached.value : result
}

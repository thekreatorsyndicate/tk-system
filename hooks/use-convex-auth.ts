import { useAuth } from "@clerk/nextjs"
import { useCallback, useMemo } from "react"

export function useConvexAuth() {
  const { isLoaded, isSignedIn, getToken } = useAuth()

  const fetchAccessToken = useCallback(
    (args?: { forceRefreshToken?: boolean }) =>
      getToken({
        template: "convex",
        skipCache: args?.forceRefreshToken,
      }),
    [getToken],
  )

  return useMemo(
    () => ({
      isLoading: !isLoaded,
      isAuthenticated: isSignedIn ?? false,
      fetchAccessToken,
    }),
    [fetchAccessToken, isLoaded, isSignedIn],
  )
}

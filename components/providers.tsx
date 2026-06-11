"use client"

import { ConvexProviderWithAuth } from "convex/react"
import { convex } from "@/lib/convex"
import { useConvexAuth } from "@/hooks/use-convex-auth"
import { ThemeProvider } from "@/components/theme-provider"
import { ToastProvider } from "@/components/toast"

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ConvexProviderWithAuth client={convex} useAuth={useConvexAuth}>
      <ThemeProvider>
        <ToastProvider>{children}</ToastProvider>
      </ThemeProvider>
    </ConvexProviderWithAuth>
  )
}

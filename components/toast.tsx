"use client"

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react"

type ToastVariant = "info" | "success" | "error"

type Toast = {
  id: string
  title: string
  description?: string
  variant: ToastVariant
}

type ToastInput = {
  title: string
  description?: string
  variant?: ToastVariant
}

type ToastContextValue = {
  showToast: (toast: ToastInput) => void
  dismissToast: (id: string) => void
}

const ToastContext = createContext<ToastContextValue | null>(null)
const TOAST_TIMEOUT_MS = 5000

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])

  const dismissToast = useCallback((id: string) => {
    setToasts((current) => current.filter((toast) => toast.id !== id))
  }, [])

  const showToast = useCallback(
    ({ title, description, variant = "info" }: ToastInput) => {
      const id =
        typeof crypto !== "undefined" && "randomUUID" in crypto
          ? crypto.randomUUID()
          : `${Date.now()}-${Math.random()}`

      setToasts((current) => [...current, { id, title, description, variant }])

      window.setTimeout(() => dismissToast(id), TOAST_TIMEOUT_MS)
    },
    [dismissToast]
  )

  const value = useMemo(
    () => ({ showToast, dismissToast }),
    [showToast, dismissToast]
  )

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        aria-live="polite"
        aria-atomic="true"
        className="fixed right-4 bottom-4 z-50 flex w-[min(24rem,calc(100vw-2rem))] flex-col gap-2"
      >
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={`rounded-lg border bg-card px-4 py-3 text-sm shadow-lg shadow-black/5 ${
              toast.variant === "error"
                ? "border-l-4 border-l-destructive"
                : toast.variant === "success"
                  ? "border-l-4 border-l-emerald-600 dark:border-l-emerald-400"
                  : "border-l-4 border-l-primary"
            }`}
          >
            <div className="flex gap-3">
              <div className="min-w-0 flex-1">
                <p
                  className={`font-medium ${
                    toast.variant === "error"
                      ? "text-destructive"
                      : "text-foreground"
                  }`}
                >
                  {toast.title}
                </p>
                {toast.description && (
                  <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                    {toast.description}
                  </p>
                )}
              </div>
              <button
                type="button"
                onClick={() => dismissToast(toast.id)}
                className="h-8 shrink-0 rounded-md px-2 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                aria-label="Dismiss notification"
              >
                Close
              </button>
            </div>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}

export function useToast() {
  const context = useContext(ToastContext)
  if (!context) {
    throw new Error("useToast must be used within ToastProvider")
  }
  return context
}

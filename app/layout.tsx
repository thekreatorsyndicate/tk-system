import type { Metadata } from "next"
import { GeistSans } from "geist/font/sans"
import { GeistMono } from "geist/font/mono"

import "./globals.css"
import { Providers } from "@/components/providers"
import {
  ClerkProvider,
  Show,
  SignInButton,
  SignUpButton,
  UserButton,
} from "@clerk/nextjs"

export const metadata: Metadata = {
  title: "AI Tutor Platform",
  description:
    "Upload course materials and get an AI tutor trained on your content",
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${GeistSans.variable} ${GeistMono.variable} antialiased`}
      >
        <ClerkProvider>
          <Providers>
            <a
              href="#main-content"
              className="sr-only z-50 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground focus:not-sr-only focus:fixed focus:top-3 focus:left-3"
            >
              Skip to content
            </a>
            <header className="sticky top-0 z-40 border-b border-border/70 bg-background/85 backdrop-blur">
              <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-4 px-4 sm:px-6 lg:px-8">
                <div className="flex min-w-0 items-center gap-3">
                  <div
                    className="flex size-8 shrink-0 items-center justify-center rounded-md border border-border bg-card text-xs font-semibold text-primary shadow-sm shadow-black/5"
                    aria-hidden="true"
                  >
                    TK
                  </div>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold tracking-tight">
                      TK System
                    </p>
                    <p className="hidden text-xs text-muted-foreground sm:block">
                      Course knowledge workspace
                    </p>
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  <Show when="signed-out">
                    <SignInButton />
                    <SignUpButton>
                      <button className="h-9 cursor-pointer rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none active:translate-y-px sm:px-4">
                        Sign Up
                      </button>
                    </SignUpButton>
                  </Show>
                  <Show when="signed-in">
                    <UserButton />
                  </Show>
                </div>
              </div>
            </header>
            {children}
          </Providers>
        </ClerkProvider>
      </body>
    </html>
  )
}

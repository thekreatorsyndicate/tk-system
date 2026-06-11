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
  description: "Upload course materials and get an AI tutor trained on your content",
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
            <header className="flex h-16 items-center justify-end gap-4 p-4">
              <Show when="signed-out">
                <SignInButton />
                <SignUpButton>
                  <button className="h-10 cursor-pointer rounded-full bg-purple-700 px-4 text-sm font-medium text-white sm:h-12 sm:px-5 sm:text-base">
                    Sign Up
                  </button>
                </SignUpButton>
              </Show>
              <Show when="signed-in">
                <UserButton />
              </Show>
            </header>
            {children}
          </Providers>
        </ClerkProvider>
      </body>
    </html>
  )
}

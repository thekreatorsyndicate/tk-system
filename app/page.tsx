"use client"

/* eslint-disable @typescript-eslint/no-explicit-any */

import { api } from "@/convex/_generated/api"
import { useAuth } from "@clerk/nextjs"
import { useStableQuery } from "@/hooks/use-stable-query"
import Link from "next/link"

export default function HomePage() {
  const { isSignedIn } = useAuth()
  const publishedKBs = useStableQuery(api.knowledgeBases.listPublished)

  return (
    <div className="flex flex-col items-center gap-12 px-6 py-16">
      <div className="flex max-w-lg flex-col items-center gap-3 text-center">
        <h1 className="text-2xl font-medium">AI Tutor Platform</h1>
        <p className="text-sm text-muted-foreground">
          Coaches create knowledge bases. Students learn through AI-powered conversations
          trained on the course material.
        </p>
        {isSignedIn ? (
          <Link
            href="/dashboard"
            className="mt-2 rounded bg-primary px-4 py-2 text-sm text-primary-foreground"
          >
            Go to Dashboard
          </Link>
        ) : (
          <p className="text-xs text-muted-foreground">Sign in to get started</p>
        )}
      </div>

      {publishedKBs && publishedKBs.length > 0 && (
        <div className="flex w-full max-w-2xl flex-col gap-4">
          <h2 className="text-sm font-medium uppercase tracking-wider text-muted-foreground">
            Available Courses
          </h2>
          <div className="grid gap-3 sm:grid-cols-2">
            {publishedKBs.map((kb: any) => (
              <Link
                key={kb._id}
                href={`/kb/${kb._id}`}
                className="rounded border p-4 transition-colors hover:bg-muted"
              >
                <h3 className="text-sm font-medium">{kb.title}</h3>
                {kb.description && (
                  <p className="mt-1 text-xs text-muted-foreground line-clamp-2">
                    {kb.description}
                  </p>
                )}
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

"use client"

/* eslint-disable @typescript-eslint/no-explicit-any */

import { useMutation } from "convex/react"
import { api } from "@/convex/_generated/api"
import { useAuth } from "@clerk/nextjs"
import { useStableQuery } from "@/hooks/use-stable-query"
import { useToast } from "@/components/toast"
import {
  ArrowLeft,
  ArrowRight,
  Books,
  ChatCircleText,
  Gauge,
  Plus,
} from "@phosphor-icons/react"
import { useRouter } from "next/navigation"
import { useEffect, useState, useRef } from "react"

export default function DashboardPage() {
  const { isLoaded, isSignedIn } = useAuth()
  const createOrGetProfile = useMutation(api.auth.getOrCreateProfile)
  const profile = useStableQuery(api.auth.getMe)
  const kbs = useStableQuery(api.knowledgeBases.list)
  const publishedKBs = useStableQuery(api.knowledgeBases.listPublished)
  const router = useRouter()
  const { showToast } = useToast()
  const [studentPreview, setStudentPreview] = useState(false)
  const [profileSetupFailed, setProfileSetupFailed] = useState(false)
  const createdRef = useRef(false)

  useEffect(() => {
    if (profile === null && !createdRef.current) {
      createdRef.current = true
      createOrGetProfile({ role: "coach" }).catch((e) => {
        console.error("Profile creation failed:", e)
        setProfileSetupFailed(true)
        showToast({
          title: "Profile setup failed",
          description:
            "We could not create your profile. Refresh the page to try again.",
          variant: "error",
        })
      })
    }
  }, [profile, createOrGetProfile, showToast])

  if (!isLoaded) return <div className="p-8 text-sm">Loading...</div>
  if (!isSignedIn)
    return <div className="p-8 text-sm">Sign in to access dashboard</div>

  if (profile === null) {
    return (
      <div className="p-8 text-sm">
        {profileSetupFailed
          ? "Profile setup failed. Refresh the page to try again."
          : "Setting up your profile..."}
      </div>
    )
  }

  if (studentPreview) {
    return (
      <StudentPreview
        publishedKBs={publishedKBs}
        onExit={() => setStudentPreview(false)}
      />
    )
  }

  return (
    <CoachDashboard
      kbs={kbs}
      router={router}
      onPreviewAsStudent={() => setStudentPreview(true)}
    />
  )
}

function CoachDashboard({
  kbs,
  router,
  onPreviewAsStudent,
}: {
  kbs: any
  router: any
  onPreviewAsStudent: () => void
}) {
  const createKB = useMutation(api.knowledgeBases.create)
  const { showToast } = useToast()
  const [title, setTitle] = useState("")
  const [description, setDescription] = useState("")
  const [creating, setCreating] = useState(false)

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    if (!title.trim() || creating) return
    setCreating(true)
    try {
      const kb = await createKB({
        title: title.trim(),
        description: description.trim() || undefined,
      })
      router.push(`/dashboard/kb/${kb!._id}`)
    } catch (err) {
      console.error("Knowledge base creation failed:", err)
      showToast({
        title: "Course creation failed",
        description: "We could not create this course. Please try again.",
        variant: "error",
      })
    } finally {
      setCreating(false)
    }
  }

  return (
    <main className="flex flex-col gap-8">
      <section className="border-b border-border/80 pb-8">
        <button
          type="button"
          onClick={() => router.push("/")}
          className="mb-3 inline-flex items-center gap-2 rounded-full border border-border/80 bg-background/80 px-3 py-1 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="size-3.5" aria-hidden="true" />
          Main workspace
        </button>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div className="max-w-2xl">
            <p className="mb-3 inline-flex items-center gap-2 text-sm font-semibold">
              <Gauge className="size-4 text-primary" aria-hidden="true" />
              Coach Dashboard
            </p>
            <h1 className="text-3xl font-semibold tracking-tight text-balance sm:text-4xl">
              Manage course knowledge bases.
            </h1>
            <p className="mt-3 max-w-xl text-sm leading-6 text-muted-foreground">
              Create course workspaces, organize source material, and preview
              the student course list when you need to check the learning side.
            </p>
          </div>
          <button
            type="button"
            onClick={onPreviewAsStudent}
            className="inline-flex w-fit items-center gap-2 rounded-md border border-border bg-card px-3 py-2 text-sm font-medium transition-colors hover:bg-muted"
          >
            <ChatCircleText className="size-4" aria-hidden="true" />
            Preview as Student
          </button>
        </div>
      </section>

      <div className="grid gap-5 lg:grid-cols-[minmax(20rem,0.75fr)_minmax(0,1.25fr)]">
        <section className="rounded-md border border-border bg-muted/35 p-5 shadow-sm shadow-black/5">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <Plus className="size-4 text-primary" aria-hidden="true" />
            New KB
          </div>
          <h2 className="mt-3 text-xl font-semibold tracking-tight">
            Create a knowledge base
          </h2>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            Start with a title. You can add documents, modules, and access after
            creation.
          </p>

          <div className="my-5 h-px bg-border/80" />

          <form onSubmit={handleCreate} className="flex flex-col gap-3">
            <label className="sr-only" htmlFor="kb-title">
              Course title
            </label>
            <input
              id="kb-title"
              className="rounded-md border border-border bg-background px-3 py-2 text-sm transition-colors outline-none placeholder:text-muted-foreground focus:border-primary"
              placeholder="Course title..."
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              disabled={creating}
            />
            <label className="sr-only" htmlFor="kb-description">
              Description
            </label>
            <input
              id="kb-description"
              className="rounded-md border border-border bg-background px-3 py-2 text-sm transition-colors outline-none placeholder:text-muted-foreground focus:border-primary"
              placeholder="Description (optional)"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              disabled={creating}
            />
            <button
              type="submit"
              disabled={creating || !title.trim()}
              className="mt-1 inline-flex w-full items-center justify-center gap-2 rounded-md bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Plus className="size-4" aria-hidden="true" />
              {creating ? "Creating..." : "Create"}
            </button>
          </form>
        </section>

        <section className="rounded-md border border-border bg-card shadow-sm shadow-black/5">
          <div className="flex flex-col gap-3 border-b border-border px-5 py-5 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <div className="flex items-center gap-2 text-sm font-semibold">
                <Books className="size-4 text-primary" aria-hidden="true" />
                Knowledge Bases
              </div>
              <h2 className="mt-2 text-xl font-semibold tracking-tight">
                Your course workspaces
              </h2>
              <p className="mt-1 max-w-2xl text-sm leading-6 text-muted-foreground">
                Open a KB to upload documents, structure modules, publish, or
                manage student access.
              </p>
            </div>
            <span className="w-fit rounded-full bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground">
              {kbs === undefined
                ? "Loading"
                : `${kbs.length} ${kbs.length === 1 ? "KB" : "KBs"}`}
            </span>
          </div>

          <div className="p-3 sm:p-4">
            {kbs === undefined ? (
              <div className="grid gap-3 sm:grid-cols-2">
                {Array.from({ length: 4 }).map((_, index) => (
                  <div
                    key={index}
                    className="h-32 animate-pulse rounded-md border border-border bg-muted/45"
                  />
                ))}
              </div>
            ) : kbs.length === 0 ? (
              <div className="flex min-h-48 flex-col items-center justify-center rounded-md border border-dashed border-border bg-muted/30 p-6 text-center">
                <Books
                  className="size-7 text-muted-foreground"
                  aria-hidden="true"
                />
                <h3 className="mt-3 text-sm font-semibold">
                  No knowledge bases yet
                </h3>
                <p className="mt-1 max-w-sm text-sm leading-6 text-muted-foreground">
                  Create your first course workspace from the panel beside this
                  list.
                </p>
              </div>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2">
                {kbs.map((kb: any) => (
                  <button
                    key={kb._id}
                    type="button"
                    onClick={() => router.push(`/dashboard/kb/${kb._id}`)}
                    className="group flex min-h-36 flex-col justify-between rounded-md border border-border bg-background p-4 text-left transition-colors hover:border-primary/45 hover:bg-muted/45"
                  >
                    <span>
                      <span className="text-sm leading-5 font-semibold">
                        {kb.title}
                      </span>
                      {kb.description && (
                        <span className="mt-2 line-clamp-2 block text-sm leading-6 text-muted-foreground">
                          {kb.description}
                        </span>
                      )}
                    </span>
                    <span className="mt-5 flex items-center justify-between gap-3">
                      <span className="rounded-full bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground">
                        {kb.isPublished ? "Published" : "Draft"}
                      </span>
                      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-primary">
                        Open
                        <ArrowRight
                          className="size-3.5 transition-transform group-hover:translate-x-0.5"
                          aria-hidden="true"
                        />
                      </span>
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </section>
      </div>
    </main>
  )
}

function StudentPreview({
  publishedKBs,
  onExit,
}: {
  publishedKBs: any
  onExit: () => void
}) {
  const router = useRouter()
  return (
    <main className="flex flex-col gap-8">
      <section className="border-b border-border/80 pb-8">
        <button
          type="button"
          onClick={() => router.push("/")}
          className="mb-3 inline-flex items-center gap-2 rounded-full border border-border/80 bg-background/80 px-3 py-1 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="size-3.5" aria-hidden="true" />
          Main workspace
        </button>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div className="max-w-2xl">
            <p className="mb-3 inline-flex items-center gap-2 text-sm font-semibold">
              <ChatCircleText
                className="size-4 text-primary"
                aria-hidden="true"
              />
              Student preview
            </p>
            <h1 className="text-3xl font-semibold tracking-tight text-balance sm:text-4xl">
              Published course chats.
            </h1>
            <p className="mt-3 max-w-xl text-sm leading-6 text-muted-foreground">
              This is the course list students can open once a KB is published
              and available to them.
            </p>
          </div>
          <button
            type="button"
            onClick={onExit}
            className="inline-flex w-fit items-center gap-2 rounded-md border border-border bg-card px-3 py-2 text-sm font-medium transition-colors hover:bg-muted"
          >
            <Books className="size-4" aria-hidden="true" />
            Exit Preview
          </button>
        </div>
      </section>

      <section className="rounded-md border border-border bg-card shadow-sm shadow-black/5">
        <div className="flex flex-col gap-3 border-b border-border px-5 py-5 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <div className="flex items-center gap-2 text-sm font-semibold">
              <ChatCircleText
                className="size-4 text-primary"
                aria-hidden="true"
              />
              Chat
            </div>
            <h2 className="mt-2 text-xl font-semibold tracking-tight">
              Available courses
            </h2>
            <p className="mt-1 max-w-2xl text-sm leading-6 text-muted-foreground">
              Open a published course to check the student chat experience.
            </p>
          </div>
          <span className="w-fit rounded-full bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground">
            {publishedKBs === undefined
              ? "Loading"
              : `${publishedKBs.length} ${publishedKBs.length === 1 ? "course" : "courses"}`}
          </span>
        </div>

        <div className="p-3 sm:p-4">
          {publishedKBs === undefined ? (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {Array.from({ length: 3 }).map((_, index) => (
                <div
                  key={index}
                  className="h-32 animate-pulse rounded-md border border-border bg-muted/45"
                />
              ))}
            </div>
          ) : publishedKBs.length === 0 ? (
            <div className="flex min-h-48 flex-col items-center justify-center rounded-md border border-dashed border-border bg-muted/30 p-6 text-center">
              <ChatCircleText
                className="size-7 text-muted-foreground"
                aria-hidden="true"
              />
              <h3 className="mt-3 text-sm font-semibold">
                No accessible published courses yet
              </h3>
              <p className="mt-1 max-w-sm text-sm leading-6 text-muted-foreground">
                Publish a KB before previewing the student chat entry point.
              </p>
            </div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {publishedKBs.map((kb: any) => (
                <button
                  key={kb._id}
                  type="button"
                  onClick={() => router.push(`/kb/${kb._id}`)}
                  className="group flex min-h-36 flex-col justify-between rounded-md border border-border bg-background p-4 text-left transition-colors hover:border-primary/45 hover:bg-muted/45"
                >
                  <span>
                    <span className="text-sm leading-5 font-semibold">
                      {kb.title}
                    </span>
                    {kb.description && (
                      <span className="mt-2 line-clamp-2 block text-sm leading-6 text-muted-foreground">
                        {kb.description}
                      </span>
                    )}
                  </span>
                  <span className="mt-5 inline-flex items-center gap-1.5 text-xs font-medium text-primary">
                    Open chat
                    <ArrowRight
                      className="size-3.5 transition-transform group-hover:translate-x-0.5"
                      aria-hidden="true"
                    />
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      </section>
    </main>
  )
}

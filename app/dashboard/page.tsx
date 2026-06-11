"use client"

/* eslint-disable @typescript-eslint/no-explicit-any */

import { useMutation } from "convex/react"
import { api } from "@/convex/_generated/api"
import { useAuth } from "@clerk/nextjs"
import { useStableQuery } from "@/hooks/use-stable-query"
import { useToast } from "@/components/toast"
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
      createOrGetProfile({ role: "coach" })
        .catch((e) => {
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
  if (!isSignedIn) return <div className="p-8 text-sm">Sign in to access dashboard</div>

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
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <button
            type="button"
            onClick={() => router.push("/")}
            className="mb-2 inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
          >
            <span aria-hidden="true">←</span>
            Back to home
          </button>
          <h1 className="text-lg font-medium">Coach Dashboard</h1>
        </div>
        <button
          onClick={onPreviewAsStudent}
          className="rounded border px-3 py-1.5 text-xs transition-colors hover:bg-muted"
        >
          Preview as Student
        </button>
      </div>

      <form
        onSubmit={handleCreate}
        className="flex flex-col gap-3 rounded border p-4"
      >
        <h2 className="text-sm font-medium">Create New Knowledge Base</h2>
        <input
          className="rounded border px-3 py-2 text-sm"
          placeholder="Course title..."
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          disabled={creating}
        />
        <input
          className="rounded border px-3 py-2 text-sm"
          placeholder="Description (optional)"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          disabled={creating}
        />
        <button
          type="submit"
          disabled={creating || !title.trim()}
          className="w-fit rounded bg-primary px-4 py-2 text-sm text-primary-foreground disabled:opacity-50"
        >
          {creating ? "Creating..." : "Create"}
        </button>
      </form>

      <h2 className="text-sm font-medium">Your Knowledge Bases</h2>
      {kbs === undefined ? (
        <div className="text-sm text-muted-foreground">Loading...</div>
      ) : kbs.length === 0 ? (
        <div className="rounded border border-dashed p-8 text-center text-sm text-muted-foreground">
          No knowledge bases yet. Create your first one above.
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {kbs.map((kb: any) => (
            <button
              key={kb._id}
              onClick={() => router.push(`/dashboard/kb/${kb._id}`)}
              className="flex flex-col gap-1 rounded border p-4 text-left transition-colors hover:bg-muted"
            >
              <span className="font-medium">{kb.title}</span>
              {kb.description && (
                <span className="text-xs text-muted-foreground line-clamp-2">
                  {kb.description}
                </span>
              )}
              <span className="mt-1 text-xs text-muted-foreground">
                {kb.isPublished ? "Published" : "Draft"}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
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
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <button
            type="button"
            onClick={() => router.push("/")}
            className="mb-2 inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
          >
            <span aria-hidden="true">←</span>
            Back to home
          </button>
          <h1 className="text-lg font-medium">Student View</h1>
          <p className="text-xs text-muted-foreground">
            This is what students see — published courses they can access.
          </p>
        </div>
        <button
          onClick={onExit}
          className="rounded border px-3 py-1.5 text-xs transition-colors hover:bg-muted"
        >
          Exit Preview
        </button>
      </div>

      {publishedKBs === undefined ? (
        <div className="text-sm text-muted-foreground">Loading...</div>
      ) : publishedKBs.length === 0 ? (
        <div className="rounded border border-dashed p-8 text-center text-sm text-muted-foreground">
          No accessible published courses yet.
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {publishedKBs.map((kb: any) => (
            <button
              key={kb._id}
              onClick={() => router.push(`/kb/${kb._id}`)}
              className="flex flex-col gap-1 rounded border p-4 text-left transition-colors hover:bg-muted"
            >
              <span className="font-medium">{kb.title}</span>
              {kb.description && (
                <span className="text-xs text-muted-foreground line-clamp-2">
                  {kb.description}
                </span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

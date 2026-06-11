"use client"

import { api } from "@/convex/_generated/api"
import { SignInButton, useAuth } from "@clerk/nextjs"
import { useStableQuery } from "@/hooks/use-stable-query"
import {
  ArrowRight,
  Books,
  ChatCircleText,
  Gauge,
  LockKey,
} from "@phosphor-icons/react"
import Link from "next/link"

type KnowledgeBaseSummary = {
  _id: string
  title: string
  description?: string | null
  isPublished?: boolean
}

export default function HomePage() {
  const { isSignedIn } = useAuth()
  const publishedKBs = useStableQuery(api.knowledgeBases.listPublished)
  const ownedKBs = useStableQuery(api.knowledgeBases.list)
  const accessibleCourses = (publishedKBs ?? []) as KnowledgeBaseSummary[]
  const ownedCourses = (ownedKBs ?? []) as KnowledgeBaseSummary[]
  const ownedCourseIds = new Set(ownedCourses.map((kb) => kb._id))
  const enrolledCourses = accessibleCourses.filter(
    (kb) => !ownedCourseIds.has(kb._id)
  )
  const yourPublishedCourses = ownedCourses.filter((kb) => kb.isPublished)
  const isLoadingCourses = publishedKBs === undefined || ownedKBs === undefined

  return (
    <main className="min-h-[calc(100svh-4rem)] bg-background px-4 pt-4 pb-12 sm:px-6 lg:px-8">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-8">
        <section className="border-b border-border/80 pb-8">
          <div className="max-w-2xl">
            <p className="mb-3 inline-flex items-center gap-2 rounded-full border border-border/80 bg-background/80 px-3 py-1 text-xs font-medium text-muted-foreground">
              <Gauge className="size-3.5" aria-hidden="true" />
              Main workspace
            </p>
            <h1 className="text-3xl font-semibold tracking-tight text-balance text-foreground sm:text-4xl">
              Learn from courses or manage the knowledge base.
            </h1>
            <p className="mt-3 max-w-xl text-sm leading-6 text-muted-foreground">
              Enrolled courses and your own published courses stay separate, so
              it is clear whether you are learning from material shared by a
              coach or testing a course you manage.
            </p>
          </div>
        </section>

        <div className="grid gap-5 lg:grid-cols-[minmax(0,1.35fr)_minmax(19rem,0.65fr)]">
          <section
            id="course-chat"
            className="rounded-md border border-border bg-card shadow-sm shadow-black/5"
          >
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
                  Choose a course to ask questions
                </h2>
                <p className="mt-1 max-w-2xl text-sm leading-6 text-muted-foreground">
                  Published chats use the materials and modules prepared for
                  each course.
                </p>
              </div>
              <span className="w-fit rounded-full bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground">
                {isLoadingCourses
                  ? "Loading"
                  : `${accessibleCourses.length} available ${accessibleCourses.length === 1 ? "course" : "courses"}`}
              </span>
            </div>

            <div className="p-3 sm:p-4">
              {isLoadingCourses ? (
                <div className="grid gap-3 sm:grid-cols-2">
                  {Array.from({ length: 4 }).map((_, index) => (
                    <div
                      key={index}
                      className="h-32 animate-pulse rounded-md border border-border bg-muted/45"
                    />
                  ))}
                </div>
              ) : (
                <div className="grid gap-5">
                  <CourseGroup
                    title="Enrolled courses"
                    description="Courses another coach has shared with you."
                    courses={enrolledCourses}
                    emptyTitle="No enrolled courses"
                    emptyDescription="When a coach enrolls you in a course, it will appear here."
                  />
                  <CourseGroup
                    title="Your courses"
                    description="Your published KBs, opened in the student chat view."
                    courses={yourPublishedCourses}
                    emptyTitle="No published courses of your own"
                    emptyDescription="Publish a KB from the dashboard to test it as a chat."
                  />
                </div>
              )}
            </div>
          </section>

          <section className="rounded-md border border-border bg-muted/35 p-5 shadow-sm shadow-black/5">
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-2 text-sm font-semibold">
                <Books className="size-4 text-primary" aria-hidden="true" />
                KB Dashboard
              </div>
              <span className="shrink-0 rounded-full bg-background/70 px-2.5 py-1 text-xs font-medium text-muted-foreground">
                {ownedKBs === undefined
                  ? "Loading"
                  : `${ownedCourses.length} ${ownedCourses.length === 1 ? "KB" : "KBs"}`}
              </span>
            </div>
            <h2 className="mt-3 text-xl font-semibold tracking-tight">
              Manage knowledge bases
            </h2>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              Upload docs, organize modules, publish courses, and manage access.
            </p>

            <div className="mt-4 mb-1 h-px bg-border/80" />

            <KnowledgeBaseList
              isSignedIn={Boolean(isSignedIn)}
              isLoading={ownedKBs === undefined}
              knowledgeBases={ownedCourses}
            />

            <div className="mt-6">
              <DashboardAction isSignedIn={Boolean(isSignedIn)} />
            </div>
          </section>
        </div>
      </div>
    </main>
  )
}

function CourseGroup({
  title,
  description,
  courses,
  emptyTitle,
  emptyDescription,
}: {
  title: string
  description: string
  courses: KnowledgeBaseSummary[]
  emptyTitle: string
  emptyDescription: string
}) {
  return (
    <section className="grid gap-3">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h3 className="text-sm font-semibold">{title}</h3>
          <p className="text-xs leading-5 text-muted-foreground">
            {description}
          </p>
        </div>
        <span className="text-xs font-medium text-muted-foreground">
          {courses.length} {courses.length === 1 ? "course" : "courses"}
        </span>
      </div>

      {courses.length > 0 ? (
        <div className="grid gap-3 sm:grid-cols-2">
          {courses.map((kb) => (
            <CourseChatCard key={kb._id} kb={kb} />
          ))}
        </div>
      ) : (
        <div className="rounded-md border border-dashed border-border bg-muted/20 p-4">
          <p className="text-sm font-medium">{emptyTitle}</p>
          <p className="mt-1 text-sm leading-6 text-muted-foreground">
            {emptyDescription}
          </p>
        </div>
      )}
    </section>
  )
}

function CourseChatCard({ kb }: { kb: KnowledgeBaseSummary }) {
  return (
    <Link
      href={`/kb/${kb._id}`}
      className="group flex min-h-36 flex-col justify-between rounded-md border border-border bg-background p-4 transition-colors hover:border-primary/45 hover:bg-muted/45"
    >
      <span>
        <span className="text-sm leading-5 font-semibold">{kb.title}</span>
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
    </Link>
  )
}

function KnowledgeBaseList({
  isSignedIn,
  isLoading,
  knowledgeBases,
}: {
  isSignedIn: boolean
  isLoading: boolean
  knowledgeBases: KnowledgeBaseSummary[]
}) {
  return (
    <div>
      {isLoading ? (
        <div className="grid gap-2">
          {Array.from({ length: 3 }).map((_, index) => (
            <div
              key={index}
              className="h-14 animate-pulse rounded-md border border-border/70 bg-background/40"
            />
          ))}
        </div>
      ) : !isSignedIn ? (
        <p className="rounded-md border border-dashed border-border bg-background/40 p-4 text-sm leading-6 text-muted-foreground">
          Sign in to see the knowledge bases you manage.
        </p>
      ) : knowledgeBases.length > 0 ? (
        <div className="divide-y divide-border/80 border-b border-border/80">
          {knowledgeBases.map((kb) => (
            <Link
              key={kb._id}
              href={`/dashboard/kb/${kb._id}`}
              className="group flex items-center justify-between gap-4 py-3 text-left transition-colors hover:text-primary"
            >
              <span className="min-w-0">
                <span className="block truncate text-sm font-medium">
                  {kb.title}
                </span>
                <span className="mt-1 block text-xs text-muted-foreground">
                  {kb.isPublished ? "Published" : "Draft"}
                </span>
              </span>
              <ArrowRight
                className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-primary"
                aria-hidden="true"
              />
            </Link>
          ))}
        </div>
      ) : (
        <p className="rounded-md border border-dashed border-border bg-background/40 p-4 text-sm leading-6 text-muted-foreground">
          No knowledge bases yet. Create your first course from the dashboard.
        </p>
      )}
    </div>
  )
}

function DashboardAction({ isSignedIn }: { isSignedIn: boolean }) {
  const className =
    "group inline-flex w-full items-center justify-center gap-2 rounded-md bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"

  if (isSignedIn) {
    return (
      <Link href="/dashboard" className={className}>
        <span className="inline-flex items-center gap-2">
          <Books className="size-4" aria-hidden="true" />
          Open KB dashboard
        </span>
      </Link>
    )
  }

  return (
    <SignInButton mode="modal">
      <button type="button" className={className}>
        <span className="inline-flex items-center gap-2">
          <LockKey className="size-4" aria-hidden="true" />
          Sign in for dashboard
        </span>
      </button>
    </SignInButton>
  )
}

"use client"

/* eslint-disable @typescript-eslint/no-explicit-any */

import { useMutation } from "convex/react"
import { api } from "@/convex/_generated/api"
import { useAuth } from "@clerk/nextjs"
import { useStableQuery } from "@/hooks/use-stable-query"
import { useToast } from "@/components/toast"
import {
  ArrowLeft,
  CheckCircle,
  Circle,
  FileText,
  UploadSimple,
} from "@phosphor-icons/react"
import { useRouter } from "next/navigation"
import { use, useState, useRef, type DragEvent } from "react"

function ModuleTreeItem({
  mod,
  depth,
  onRemove,
  onAddSub,
}: {
  mod: any
  depth: number
  onRemove: (id: string) => void
  onAddSub: (parentId: string, name: string) => void
}) {
  const children = mod.children ?? []
  const [isAddingSubModule, setIsAddingSubModule] = useState(false)
  const [subModuleName, setSubModuleName] = useState("")
  const [isConfirmingRemove, setIsConfirmingRemove] = useState(false)

  function cancelSubModule() {
    setIsAddingSubModule(false)
    setSubModuleName("")
  }

  function handleAddSubModule(e: React.FormEvent) {
    e.preventDefault()
    const name = subModuleName.trim()
    if (!name) return
    onAddSub(mod._id, name)
    cancelSubModule()
  }

  return (
    <div className="flex flex-col gap-1" style={{ marginLeft: depth * 16 }}>
      <div className="flex items-center justify-between rounded-md border border-border bg-background px-3 py-2">
        <span className="text-sm">{mod.name}</span>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setIsAddingSubModule(true)}
            className="rounded-md px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            + Sub
          </button>
          <button
            type="button"
            onClick={() => setIsConfirmingRemove(true)}
            className="rounded-md px-2 py-1 text-xs text-destructive transition-colors hover:bg-destructive/10"
          >
            Remove
          </button>
        </div>
      </div>
      {isAddingSubModule && (
        <form
          onSubmit={handleAddSubModule}
          className="flex flex-col gap-2 rounded-md border border-dashed border-border bg-muted/20 px-3 py-2"
        >
          <label
            className="text-xs font-medium"
            htmlFor={`sub-module-${mod._id}`}
          >
            Sub-module name
          </label>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <input
              id={`sub-module-${mod._id}`}
              autoFocus
              value={subModuleName}
              onChange={(e) => setSubModuleName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") cancelSubModule()
              }}
              placeholder="Practice set"
              className="min-w-0 flex-1 rounded-md border border-border bg-background px-3 py-1.5 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-ring/20"
            />
            <div className="flex gap-2">
              <button
                type="submit"
                disabled={!subModuleName.trim()}
                className="rounded-md border border-border px-3 py-1.5 text-xs transition-colors hover:bg-muted disabled:opacity-50"
              >
                Add
              </button>
              <button
                type="button"
                onClick={cancelSubModule}
                className="rounded-md border border-border px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                Cancel
              </button>
            </div>
          </div>
        </form>
      )}
      {isConfirmingRemove && (
        <div className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2">
          <p className="text-xs font-medium text-destructive">
            Remove this module?
          </p>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            This removes the module and its sub-modules. Documents in them stay
            in the knowledge base without a module.
          </p>
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              onClick={() => setIsConfirmingRemove(false)}
              className="rounded-md border border-border px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => {
                onRemove(mod._id)
                setIsConfirmingRemove(false)
              }}
              className="rounded-md border border-destructive/40 px-3 py-1.5 text-xs text-destructive hover:bg-destructive/10"
            >
              Remove module
            </button>
          </div>
        </div>
      )}
      {children.map((child: any) => (
        <ModuleTreeItem
          key={child._id}
          mod={child}
          depth={depth + 1}
          onRemove={onRemove}
          onAddSub={onAddSub}
        />
      ))}
    </div>
  )
}

export default function KBDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = use(params)
  useAuth()
  const profile = useStableQuery(api.auth.getMe)
  const kb = useStableQuery(api.knowledgeBases.getForDashboard, {
    id: id as any,
  })
  const documents = useStableQuery(api.documents.list, {
    knowledgeBaseId: id as any,
  })
  const moduleTree = useStableQuery(api.modules.getTreeForDashboard, {
    knowledgeBaseId: id as any,
  })
  const enrollments = useStableQuery(api.knowledgeBases.listEnrollments, {
    knowledgeBaseId: id as any,
  })
  const router = useRouter()
  const updateKB = useMutation(api.knowledgeBases.update)
  const removeKB = useMutation(api.knowledgeBases.remove)
  const enrollStudent = useMutation(api.knowledgeBases.enrollStudentByEmail)
  const removeEnrollment = useMutation(api.knowledgeBases.removeEnrollment)
  const createModule = useMutation(api.modules.create)
  const removeModule = useMutation(api.modules.remove)
  const generateUrl = useMutation(api.documents.generateUploadUrl)
  const createDocRecord = useMutation(api.documents.createRecord)
  const removeDoc = useMutation(api.documents.remove)
  const retryDoc = useMutation(api.documents.retryProcessing)
  const { showToast } = useToast()

  const [moduleName, setModuleName] = useState("")
  const [uploadModuleId, setUploadModuleId] = useState<string>("")
  const [uploading, setUploading] = useState(false)
  const [uploadQueue, setUploadQueue] = useState<
    { name: string; status: string }[]
  >([])
  const [dragOver, setDragOver] = useState(false)
  const [publishing, setPublishing] = useState(false)
  const [publishError, setPublishError] = useState<string | null>(null)
  const [deletingKb, setDeletingKb] = useState(false)
  const [confirmingKbDelete, setConfirmingKbDelete] = useState(false)
  const [addingModule, setAddingModule] = useState(false)
  const [studentEmail, setStudentEmail] = useState("")
  const [enrolling, setEnrolling] = useState(false)
  const [enrollmentMessage, setEnrollmentMessage] = useState<string | null>(
    null
  )
  const [retryingDocIds, setRetryingDocIds] = useState<Set<string>>(
    () => new Set()
  )
  const [deletingDocIds, setDeletingDocIds] = useState<Set<string>>(
    () => new Set()
  )
  const [confirmingDocId, setConfirmingDocId] = useState<string | null>(null)
  const [documentsOpen, setDocumentsOpen] = useState(false)
  const [openDocumentGroupKeys, setOpenDocumentGroupKeys] = useState<
    Set<string>
  >(() => new Set())
  const fileInputRef = useRef<HTMLInputElement>(null)

  if (
    profile === undefined ||
    kb === undefined ||
    documents === undefined ||
    moduleTree === undefined ||
    enrollments === undefined
  ) {
    return <div className="p-8 text-sm">Loading...</div>
  }

  if (!kb) return <div className="p-8 text-sm">Knowledge base not found</div>

  const safeKb = kb
  const flattenedModules = flattenModuleTree(moduleTree)
  const publishReadiness = getPublishReadiness(safeKb, documents)
  const publishBlocked = !safeKb.isPublished && !publishReadiness.canPublish
  const documentSummary = getDocumentSummary(documents)
  const documentGroups = groupDocumentsByTopModule(documents, flattenedModules)
  const hasDocuments = documents.length > 0

  function toggleDocumentGroup(groupKey: string) {
    setOpenDocumentGroupKeys((current) => {
      const next = new Set(current)
      if (next.has(groupKey)) {
        next.delete(groupKey)
      } else {
        next.add(groupKey)
      }
      return next
    })
  }
  async function handlePublish() {
    if (publishing) return
    setPublishError(null)
    if (publishBlocked) {
      setPublishError(getPublishBlockedMessage(publishReadiness))
      return
    }

    setPublishing(true)
    try {
      await updateKB({ id: safeKb._id, isPublished: !safeKb.isPublished })
    } catch (err) {
      console.error("Publish update failed:", err)
      setPublishError(
        err instanceof Error ? err.message : "Could not update publish status."
      )
      showToast({
        title: safeKb.isPublished ? "Unpublish failed" : "Publish failed",
        description: "We could not update this course. Please try again.",
        variant: "error",
      })
    } finally {
      setPublishing(false)
    }
  }

  async function handleDelete() {
    if (deletingKb) return
    setDeletingKb(true)
    try {
      await removeKB({ id: safeKb._id })
      router.push("/dashboard")
    } catch (err) {
      console.error("Knowledge base deletion failed:", err)
      showToast({
        title: "Delete failed",
        description: "We could not delete this course. Please try again.",
        variant: "error",
      })
      setDeletingKb(false)
    }
  }

  async function handleEnrollStudent(e: React.FormEvent) {
    e.preventDefault()
    const email = studentEmail.trim()
    if (!email || enrolling) return

    setEnrolling(true)
    setEnrollmentMessage(null)
    try {
      await enrollStudent({ knowledgeBaseId: safeKb._id, email })
      setStudentEmail("")
      setEnrollmentMessage("Student enrolled.")
    } catch (err) {
      console.error("Student enrollment failed:", err)
      setEnrollmentMessage(getEnrollmentErrorMessage(err))
    } finally {
      setEnrolling(false)
    }
  }

  async function handleRemoveEnrollment(enrollmentId: string) {
    try {
      await removeEnrollment({ id: enrollmentId as any })
    } catch (err) {
      console.error("Enrollment removal failed:", err)
      showToast({
        title: "Remove access failed",
        description:
          "We could not remove this student's access. Please try again.",
        variant: "error",
      })
    }
  }

  async function handleAddModule() {
    if (!moduleName.trim() || addingModule) return
    setAddingModule(true)
    try {
      await createModule({
        knowledgeBaseId: safeKb._id,
        name: moduleName.trim(),
      })
      setModuleName("")
    } catch (err) {
      console.error("Module creation failed:", err)
      showToast({
        title: "Module creation failed",
        description: "We could not add this module. Please try again.",
        variant: "error",
      })
    } finally {
      setAddingModule(false)
    }
  }

  async function handleAddSubModule(parentId: string, name: string) {
    try {
      await createModule({
        knowledgeBaseId: safeKb._id,
        name,
        parentId: parentId as any,
      })
    } catch (err) {
      console.error("Sub-module creation failed:", err)
      showToast({
        title: "Sub-module creation failed",
        description: "We could not add this sub-module. Please try again.",
        variant: "error",
      })
    }
  }

  function setQueuedFileStatus(filename: string, status: string) {
    setUploadQueue((q) =>
      q.map((item) => (item.name === filename ? { ...item, status } : item))
    )
  }

  async function uploadFile(file: File) {
    setUploadQueue((q) => [...q, { name: file.name, status: "uploading" }])
    let uploadUrl: string
    let storageId: string

    try {
      const result = await generateUrl({
        knowledgeBaseId: safeKb._id,
        moduleId: uploadModuleId ? (uploadModuleId as any) : undefined,
        filename: file.name,
        contentType: file.type,
      })
      uploadUrl = result.storageId
    } catch (err) {
      console.error("Upload URL generation failed:", err)
      setQueuedFileStatus(file.name, "error")
      showToast({
        title: "Could not start upload",
        description: `We could not prepare an upload URL for ${file.name}.`,
        variant: "error",
      })
      return
    }

    try {
      const uploadRes = await fetch(uploadUrl, {
        method: "POST",
        headers: { "Content-Type": file.type },
        body: file,
      })

      if (!uploadRes.ok) {
        throw new Error(`Upload failed with status ${uploadRes.status}`)
      }

      const body = await uploadRes.json()
      storageId = body.storageId
    } catch (err) {
      console.error("Upload POST failed:", err)
      setQueuedFileStatus(file.name, "error")
      showToast({
        title: "File upload failed",
        description: `We could not upload ${file.name}. Please try again.`,
        variant: "error",
      })
      return
    }

    try {
      await createDocRecord({
        knowledgeBaseId: safeKb._id,
        moduleId: uploadModuleId ? (uploadModuleId as any) : undefined,
        storageId: storageId as any,
        filename: file.name,
        contentType: file.type,
      })

      setQueuedFileStatus(file.name, "done")
    } catch (err) {
      console.error("Document record creation failed:", err)
      setQueuedFileStatus(file.name, "error")
      showToast({
        title: "Document save failed",
        description: `${file.name} uploaded, but we could not add it to this course.`,
        variant: "error",
      })
    }
  }

  async function handleDrop(e: DragEvent) {
    e.preventDefault()
    setDragOver(false)
    if (uploading) return
    const files = Array.from(e.dataTransfer.files)
    if (files.length === 0) return
    setUploading(true)
    try {
      for (const file of files) {
        await uploadFile(file)
      }
    } finally {
      setUploading(false)
    }
  }

  function handleDragOver(e: DragEvent) {
    e.preventDefault()
    setDragOver(true)
  }

  function handleDragLeave() {
    setDragOver(false)
  }

  async function handleInputUpload(e: React.ChangeEvent<HTMLInputElement>) {
    if (uploading) return
    const files = Array.from(e.target.files ?? [])
    if (files.length === 0) return
    setUploading(true)
    try {
      for (const file of files) {
        await uploadFile(file)
      }
    } finally {
      setUploading(false)
      e.target.value = ""
    }
  }

  async function handleRetryDocument(docId: string) {
    if (retryingDocIds.has(docId)) return
    setRetryingDocIds((current) => new Set(current).add(docId))
    try {
      await retryDoc({ id: docId as any })
    } catch (err) {
      console.error("Document retry failed:", err)
      showToast({
        title: "Retry failed",
        description: "We could not restart processing for this document.",
        variant: "error",
      })
    } finally {
      setRetryingDocIds((current) => {
        const next = new Set(current)
        next.delete(docId)
        return next
      })
    }
  }

  async function handleDeleteDocument(docId: string) {
    if (deletingDocIds.has(docId)) return
    setDeletingDocIds((current) => new Set(current).add(docId))
    try {
      await removeDoc({ id: docId as any })
      setConfirmingDocId((current) => (current === docId ? null : current))
    } catch (err) {
      console.error("Document deletion failed:", err)
      showToast({
        title: "Delete failed",
        description: "We could not delete this document. Please try again.",
        variant: "error",
      })
    } finally {
      setDeletingDocIds((current) => {
        const next = new Set(current)
        next.delete(docId)
        return next
      })
    }
  }

  return (
    <main
      id="main-content"
      className="grid gap-x-8 gap-y-6 lg:grid-cols-[minmax(0,1fr)_23rem] lg:items-start"
    >
      <section className="min-w-0 rounded-lg border border-border/80 bg-card/70 p-5 shadow-sm shadow-black/5 sm:p-6">
        <button
          type="button"
          onClick={() => router.push("/dashboard")}
          className="mb-4 inline-flex items-center gap-2 rounded-md border border-border/80 bg-background/80 px-3 py-1 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="size-3.5" aria-hidden="true" />
          Back to dashboard
        </button>
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-3xl leading-tight font-semibold tracking-tight text-balance sm:text-4xl">
            {safeKb.title}
          </h1>
          <span className="rounded-md border border-border/70 bg-background px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
            {safeKb.isPublished ? "Published" : "Draft"}
          </span>
        </div>
        {safeKb.description && (
          <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
            {safeKb.description}
          </p>
        )}
        <div className="mt-5 grid gap-2 sm:grid-cols-3">
          <HeaderStat label="Modules" value={flattenedModules.length} />
          <HeaderStat label="Documents" value={documents.length} />
          <HeaderStat label="Ready" value={documentSummary.ready} />
        </div>
      </section>

      <aside className="flex flex-col gap-3 lg:sticky lg:top-20 lg:row-span-2">
        <section className="flex flex-col gap-4 rounded-lg border border-border bg-card p-4 shadow-sm shadow-black/5">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-medium">Publication readiness</h2>
              <p className="text-xs text-muted-foreground">
                {safeKb.isPublished ? "Published" : "Draft"}
              </p>
            </div>
            <button
              onClick={handlePublish}
              disabled={publishBlocked || publishing || deletingKb}
              className="rounded-md border border-border px-3 py-1.5 text-xs font-medium transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
            >
              {publishing
                ? "Saving..."
                : safeKb.isPublished
                  ? "Unpublish"
                  : "Publish"}
            </button>
          </div>

          <div className="flex flex-col gap-1.5">
            {publishReadiness.checklist.map((item) => (
              <div key={item.label} className="flex items-center gap-2 text-xs">
                {item.done ? (
                  <CheckCircle
                    className="size-4 shrink-0 text-emerald-600 dark:text-emerald-400"
                    aria-hidden="true"
                  />
                ) : (
                  <Circle
                    className="size-4 shrink-0 text-muted-foreground"
                    aria-hidden="true"
                  />
                )}
                <span
                  className={
                    item.done ? "text-foreground" : "text-muted-foreground"
                  }
                >
                  {item.label}
                </span>
              </div>
            ))}
          </div>

          {publishBlocked && (
            <p className="text-xs text-destructive">
              {getPublishBlockedMessage(publishReadiness)}
            </p>
          )}

          {publishError && (
            <p className="text-xs text-destructive">{publishError}</p>
          )}

          {publishReadiness.failedDocuments.length > 0 && (
            <div className="flex flex-col gap-2 border-t border-border/70 pt-3">
              <p className="text-xs font-medium text-destructive">
                Failed documents
              </p>
              {publishReadiness.failedDocuments.map((doc: any) => (
                <div
                  key={doc._id}
                  className="flex items-start justify-between gap-3 text-xs"
                >
                  <div className="min-w-0">
                    <p className="truncate text-foreground">{doc.filename}</p>
                    {doc.errorMessage && (
                      <p className="line-clamp-2 text-destructive">
                        {doc.errorMessage}
                      </p>
                    )}
                  </div>
                  <button
                    onClick={() => handleRetryDocument(doc._id)}
                    disabled={retryingDocIds.has(doc._id)}
                    className="shrink-0 rounded-md px-2 py-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50"
                  >
                    {retryingDocIds.has(doc._id) ? "Retrying..." : "Retry"}
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4 shadow-sm shadow-black/5">
          <div>
            <h2 className="text-sm font-medium">Student access</h2>
            <p className="text-xs text-muted-foreground">
              {safeKb.isPublished
                ? "Enrolled students can open this course."
                : "Publish this course before enrolled students can open it."}
            </p>
          </div>
          <form onSubmit={handleEnrollStudent} className="grid gap-2">
            <label className="text-xs font-medium" htmlFor="student-email">
              Email
            </label>
            <div className="flex gap-2">
              <input
                id="student-email"
                className="min-w-0 flex-1 rounded-md border border-border bg-background px-3 py-1.5 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-ring/20"
                type="email"
                placeholder="student@example.com"
                value={studentEmail}
                onChange={(e) => setStudentEmail(e.target.value)}
                disabled={enrolling}
              />
              <button
                type="submit"
                disabled={!studentEmail.trim() || enrolling}
                className="rounded-md border border-border px-3 py-1.5 text-xs font-medium transition-colors hover:bg-muted disabled:opacity-50"
              >
                {enrolling ? "Enrolling..." : "Enroll"}
              </button>
            </div>
          </form>
          {enrollmentMessage && (
            <p className="text-xs text-muted-foreground">{enrollmentMessage}</p>
          )}
          {enrollments.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              No students enrolled yet.
            </p>
          ) : (
            <div className="flex flex-col">
              {enrollments.map((enrollment: any) => (
                <div
                  key={enrollment._id}
                  className="flex items-center justify-between gap-3 border-t border-border/70 py-2 first:border-t-0"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm">
                      {enrollment.profile?.name ?? "Unknown student"}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      {enrollment.profile?.email ?? "Profile removed"}
                    </p>
                  </div>
                  <button
                    onClick={() => handleRemoveEnrollment(enrollment._id)}
                    className="shrink-0 rounded-md px-2 py-1 text-xs text-destructive transition-colors hover:bg-destructive/10"
                  >
                    Remove
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="rounded-lg border border-destructive/30 bg-destructive/5 p-4">
          <h2 className="text-sm font-medium text-destructive">Danger zone</h2>
          {confirmingKbDelete ? (
            <div className="mt-3">
              <p className="text-sm font-medium text-destructive">
                Delete this knowledge base?
              </p>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                This permanently deletes the course, its modules, documents, and
                conversations. This cannot be undone.
              </p>
              <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:justify-end">
                <button
                  type="button"
                  onClick={() => setConfirmingKbDelete(false)}
                  disabled={deletingKb}
                  className="rounded-md border border-border px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleDelete}
                  disabled={deletingKb || publishing}
                  className="rounded-md border border-destructive/40 px-3 py-1.5 text-xs text-destructive hover:bg-destructive/10 disabled:opacity-50"
                >
                  {deletingKb ? "Deleting..." : "Delete knowledge base"}
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmingKbDelete(true)}
              disabled={publishing}
              className="mt-3 rounded-md border border-destructive/30 px-3 py-1.5 text-xs font-medium text-destructive transition-colors hover:bg-destructive/10 disabled:opacity-50"
            >
              Delete
            </button>
          )}
        </section>
      </aside>

      <div className="flex min-w-0 flex-col gap-5">
        <section className="flex flex-col gap-3 rounded-lg border border-border bg-card p-5 shadow-sm shadow-black/5">
          <h2 className="text-sm font-medium">Modules</h2>
          {moduleTree.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              No modules yet. Add one below.
            </p>
          ) : (
            <div className="flex flex-col gap-1">
              {moduleTree.map((mod: any) => (
                <ModuleTreeItem
                  key={mod._id}
                  mod={mod}
                  depth={0}
                  onRemove={(id) => {
                    removeModule({ id: id as any }).catch((err) => {
                      console.error("Module deletion failed:", err)
                      showToast({
                        title: "Delete failed",
                        description:
                          "We could not delete this module. Please try again.",
                        variant: "error",
                      })
                    })
                  }}
                  onAddSub={handleAddSubModule}
                />
              ))}
            </div>
          )}
          <div className="grid gap-2">
            <label className="text-xs font-medium" htmlFor="module-name">
              Module name
            </label>
            <div className="flex gap-2">
              <input
                id="module-name"
                className="flex-1 rounded-md border border-border bg-background px-3 py-1.5 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-ring/20"
                placeholder="Unit 1"
                value={moduleName}
                onChange={(e) => setModuleName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleAddModule()}
                disabled={addingModule}
              />
              <button
                onClick={handleAddModule}
                disabled={!moduleName.trim() || addingModule}
                className="rounded-md border border-border px-3 py-1.5 text-xs font-medium transition-colors hover:bg-muted disabled:opacity-50"
              >
                {addingModule ? "Adding..." : "Add"}
              </button>
            </div>
          </div>
        </section>

        <section className="flex flex-col gap-3 rounded-lg border border-border bg-card p-5 shadow-sm shadow-black/5">
          <div className="flex items-center gap-2">
            <UploadSimple className="size-4 text-primary" aria-hidden="true" />
            <h2 className="text-sm font-medium">Upload documents</h2>
          </div>
          <div className="grid gap-2">
            <label className="text-xs font-medium" htmlFor="upload-module">
              Add to module
            </label>
            <select
              id="upload-module"
              className="w-fit max-w-full rounded-md border border-border bg-background px-3 py-1.5 text-xs outline-none focus:border-primary focus:ring-2 focus:ring-ring/20"
              value={uploadModuleId}
              onChange={(e) => setUploadModuleId(e.target.value)}
            >
              <option value="">No module (KB-level)</option>
              {flattenedModules.map((mod: any) => (
                <option key={mod._id} value={mod._id}>
                  {"  ".repeat(mod.depth)}
                  {mod.depth > 0 ? "└ " : ""}
                  {mod.name}
                </option>
              ))}
            </select>
            <p className="text-xs text-muted-foreground">
              Selected files will inherit this module assignment.
            </p>
          </div>
          <div
            onDrop={handleDrop}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onClick={() => {
              if (!uploading) fileInputRef.current?.click()
            }}
            className={`flex cursor-pointer flex-col items-center gap-2 rounded-lg border-2 border-dashed p-8 text-sm transition-colors ${
              dragOver
                ? "border-primary bg-primary/5"
                : uploading
                  ? "border-muted-foreground/20 opacity-70"
                  : "border-muted-foreground/30 hover:border-muted-foreground/50"
            }`}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf,.docx,.txt,.md,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain,text/markdown"
              multiple
              className="hidden"
              onChange={handleInputUpload}
              disabled={uploading}
            />
            {uploading ? (
              <span className="text-muted-foreground">Uploading files...</span>
            ) : (
              <>
                <UploadSimple
                  className="size-6 text-muted-foreground"
                  aria-hidden="true"
                />
                <span className="font-medium">Drop files here</span>
                <span className="text-xs text-muted-foreground">
                  or click to browse
                </span>
              </>
            )}
          </div>
          {uploadQueue.length > 0 && (
            <div className="flex flex-col gap-1 rounded-md border border-border/70 bg-background/50 p-2">
              {uploadQueue.map((item) => (
                <div
                  key={item.name}
                  className="flex items-center gap-2 text-xs"
                >
                  <span
                    className={
                      item.status === "done"
                        ? "text-emerald-600 dark:text-emerald-400"
                        : item.status === "error"
                          ? "text-destructive"
                          : "text-muted-foreground"
                    }
                  >
                    {item.status === "done"
                      ? "✓"
                      : item.status === "error"
                        ? "✗"
                        : "⋯"}
                  </span>
                  <span className="truncate">{item.name}</span>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="flex flex-col gap-3 rounded-lg border border-border bg-card p-5 shadow-sm shadow-black/5">
          <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <div className="flex items-center gap-2">
                <FileText className="size-4 text-primary" aria-hidden="true" />
                <h2 className="text-sm font-medium">Documents</h2>
              </div>
              <p className="text-xs text-muted-foreground">
                Students can use course material after documents are ready.
              </p>
            </div>
            {hasDocuments && (
              <div className="flex flex-wrap gap-2 text-xs">
                <SummaryPill
                  label="Ready"
                  value={documentSummary.ready}
                  tone="ready"
                />
                <SummaryPill
                  label="Processing"
                  value={documentSummary.processing}
                  tone="processing"
                />
                <SummaryPill
                  label="Failed"
                  value={documentSummary.failed}
                  tone="failed"
                />
              </div>
            )}
          </div>

          {hasDocuments && (
            <div
              className={`rounded-lg border px-4 py-3 text-sm ${getReadinessClassName(documentSummary)}`}
            >
              <div className="font-medium">
                {getReadinessTitle(documentSummary)}
              </div>
              <div className="mt-1 text-xs opacity-80">
                {getReadinessMessage(documentSummary)}
              </div>
            </div>
          )}

          {documents.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border bg-muted/20 p-6 text-sm">
              <div className="font-medium">No documents uploaded yet.</div>
              <p className="mt-1 text-xs text-muted-foreground">
                Choose a module above, then upload a PDF, DOCX, TXT, or Markdown
                file. After processing finishes, the course will be ready for
                student questions.
              </p>
            </div>
          ) : (
            <div className="overflow-hidden rounded-lg border border-border bg-card">
              <button
                type="button"
                aria-expanded={documentsOpen}
                onClick={() => setDocumentsOpen((open) => !open)}
                className="flex w-full items-center justify-between gap-4 px-4 py-3 text-left transition-colors hover:bg-muted"
              >
                <span className="min-w-0">
                  <span className="block text-sm font-medium">
                    {documents.length} uploaded{" "}
                    {documents.length === 1 ? "document" : "documents"}
                  </span>
                  <span className="mt-1 block text-xs text-muted-foreground">
                    Grouped by module. Submodule documents count toward their
                    parent module.
                  </span>
                </span>
                <span className="flex shrink-0 items-center gap-2 text-xs font-medium text-muted-foreground">
                  {documentsOpen ? "Hide" : "Show"}
                  <span
                    aria-hidden="true"
                    className={`transition-transform ${documentsOpen ? "rotate-180" : ""}`}
                  >
                    ↓
                  </span>
                </span>
              </button>

              {documentsOpen && (
                <div className="flex flex-col border-t border-border/70">
                  {documentGroups.map((group) => (
                    <div
                      key={group.key}
                      className="border-t border-border/70 first:border-t-0"
                    >
                      <button
                        type="button"
                        aria-expanded={openDocumentGroupKeys.has(group.key)}
                        onClick={() => toggleDocumentGroup(group.key)}
                        className="flex w-full items-center justify-between gap-4 px-4 py-3 text-left transition-colors hover:bg-muted"
                      >
                        <span className="min-w-0">
                          <span className="block text-sm font-medium">
                            {group.label}
                          </span>
                          <span className="mt-1 block text-xs text-muted-foreground">
                            {group.childGroups.length > 0
                              ? `${group.childGroups.length} submodule ${group.childGroups.length === 1 ? "group" : "groups"} included`
                              : "No submodule documents"}
                          </span>
                        </span>
                        <span className="flex shrink-0 items-center gap-3">
                          <span className="rounded-md border border-border/70 bg-muted px-2.5 py-1 text-xs font-semibold text-foreground">
                            {group.totalCount}{" "}
                            {group.totalCount === 1 ? "doc" : "docs"}
                          </span>
                          <span
                            aria-hidden="true"
                            className={`text-xs text-muted-foreground transition-transform ${
                              openDocumentGroupKeys.has(group.key)
                                ? "rotate-180"
                                : ""
                            }`}
                          >
                            ↓
                          </span>
                        </span>
                      </button>

                      {openDocumentGroupKeys.has(group.key) && (
                        <div className="flex flex-col gap-3 border-t border-border/70 bg-background/40 p-3">
                          {group.documents.length > 0 && (
                            <div className="flex flex-col gap-2">
                              {group.childGroups.length > 0 && (
                                <h3 className="text-xs font-medium text-muted-foreground">
                                  {group.label}
                                </h3>
                              )}
                              {group.documents.map((doc: any) => (
                                <DocumentCard
                                  key={doc._id}
                                  doc={doc}
                                  modules={flattenedModules}
                                  confirmingDocId={confirmingDocId}
                                  deletingDocIds={deletingDocIds}
                                  retryingDocIds={retryingDocIds}
                                  onConfirmDelete={setConfirmingDocId}
                                  onCancelDelete={() =>
                                    setConfirmingDocId(null)
                                  }
                                  onDelete={handleDeleteDocument}
                                  onRetry={handleRetryDocument}
                                />
                              ))}
                            </div>
                          )}

                          {group.childGroups.map((childGroup) => (
                            <div
                              key={childGroup.key}
                              className="flex flex-col gap-2 border-l border-border/70 pl-3"
                            >
                              <div className="flex items-center justify-between gap-3">
                                <h3 className="text-xs font-medium text-muted-foreground">
                                  {childGroup.label}
                                </h3>
                                <span className="text-xs text-muted-foreground">
                                  {childGroup.documents.length}
                                </span>
                              </div>
                              {childGroup.documents.map((doc: any) => (
                                <DocumentCard
                                  key={doc._id}
                                  doc={doc}
                                  modules={flattenedModules}
                                  confirmingDocId={confirmingDocId}
                                  deletingDocIds={deletingDocIds}
                                  retryingDocIds={retryingDocIds}
                                  onConfirmDelete={setConfirmingDocId}
                                  onCancelDelete={() =>
                                    setConfirmingDocId(null)
                                  }
                                  onDelete={handleDeleteDocument}
                                  onRetry={handleRetryDocument}
                                />
                              ))}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </section>
      </div>
    </main>
  )
}

function HeaderStat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md border border-border/70 bg-background/70 px-3 py-2">
      <p className="font-mono text-lg leading-none font-semibold tabular-nums">
        {value}
      </p>
      <p className="mt-1 text-xs text-muted-foreground">{label}</p>
    </div>
  )
}

function flattenModuleTree(modules: any[], depth = 0): any[] {
  return modules.flatMap((mod) => [
    { ...mod, depth },
    ...flattenModuleTree(mod.children ?? [], depth + 1),
  ])
}

function SummaryPill({
  label,
  value,
  tone,
}: {
  label: string
  value: number
  tone: "ready" | "processing" | "failed"
}) {
  return (
    <span
      className={`rounded-md border px-2.5 py-1 ${getSummaryPillClassName(tone)}`}
    >
      <span className="font-medium">{value}</span> {label}
    </span>
  )
}

function StatusBadge({ status }: { status: string }) {
  const state = getDocumentStatusState(status)
  return (
    <span
      className={`rounded-md border px-2 py-0.5 font-medium ${state.className}`}
    >
      {state.label}
    </span>
  )
}

function DocumentCard({
  doc,
  modules,
  confirmingDocId,
  deletingDocIds,
  retryingDocIds,
  onConfirmDelete,
  onCancelDelete,
  onDelete,
  onRetry,
}: {
  doc: any
  modules: any[]
  confirmingDocId: string | null
  deletingDocIds: Set<string>
  retryingDocIds: Set<string>
  onConfirmDelete: (id: string) => void
  onCancelDelete: () => void
  onDelete: (id: string) => void
  onRetry: (id: string) => void
}) {
  return (
    <div className="rounded-lg border border-border bg-card px-3 py-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 flex-col gap-2">
          <div className="flex min-w-0 flex-col gap-1">
            <span className="truncate text-sm font-medium">{doc.filename}</span>
            <span className="text-xs text-muted-foreground">
              Module: {getDocumentModulePath(doc, modules)}
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <StatusBadge status={doc.status} />
            {getVisibleDocumentMetadata(doc).map((item) => (
              <span key={item} className="text-muted-foreground">
                {item}
              </span>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">
            {getStatusHelpText(doc)}
          </p>
          {doc.status === "error" && (
            <div className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
              {doc.errorMessage ||
                "Processing failed. Retry this document or delete it and upload a new copy."}
            </div>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-3 self-start">
          {doc.status === "error" && (
            <button
              type="button"
              onClick={() => onRetry(doc._id)}
              disabled={retryingDocIds.has(doc._id)}
              className="rounded-md border border-destructive/30 px-2.5 py-1.5 text-xs font-medium text-destructive transition-colors hover:bg-destructive/10 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {retryingDocIds.has(doc._id) ? "Retrying..." : "Retry"}
            </button>
          )}
          <button
            type="button"
            onClick={() => onConfirmDelete(doc._id)}
            disabled={deletingDocIds.has(doc._id)}
            className="rounded-md px-2 py-1 text-xs text-destructive transition-colors hover:bg-destructive/10 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Delete
          </button>
        </div>
      </div>
      {confirmingDocId === doc._id && (
        <div className="mt-3 rounded-md border border-destructive/30 bg-destructive/5 p-3">
          <p className="text-xs font-medium text-destructive">
            Delete this document?
          </p>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            This removes the uploaded file and its processed course content from
            this knowledge base. This cannot be undone.
          </p>
          <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:justify-end">
            <button
              type="button"
              onClick={onCancelDelete}
              disabled={deletingDocIds.has(doc._id)}
              className="rounded-md border border-border px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => onDelete(doc._id)}
              disabled={deletingDocIds.has(doc._id)}
              className="rounded-md border border-destructive/40 px-3 py-1.5 text-xs text-destructive hover:bg-destructive/10 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {deletingDocIds.has(doc._id) ? "Deleting..." : "Delete document"}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function getDocumentStatusState(status: string) {
  if (status === "ready") {
    return {
      label: "Ready",
      className:
        "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/70 dark:bg-emerald-950/40 dark:text-emerald-300",
    }
  }
  if (status === "error") {
    return {
      label: "Failed",
      className: "border-destructive/30 bg-destructive/10 text-destructive",
    }
  }
  if (status === "processing") {
    return {
      label: "Processing",
      className:
        "border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-900/70 dark:bg-sky-950/40 dark:text-sky-300",
    }
  }
  return {
    label: "Uploading",
    className:
      "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900/70 dark:bg-amber-950/40 dark:text-amber-300",
  }
}

function getSummaryPillClassName(tone: "ready" | "processing" | "failed") {
  if (tone === "ready") {
    return "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/70 dark:bg-emerald-950/40 dark:text-emerald-300"
  }
  if (tone === "failed") {
    return "border-destructive/30 bg-destructive/10 text-destructive"
  }
  return "border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-900/70 dark:bg-sky-950/40 dark:text-sky-300"
}

function formatFileSize(bytes?: number) {
  if (!bytes) return null
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function formatProcessedAt(timestamp?: number) {
  if (!timestamp) return null
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(timestamp))
}

function getEnrollmentErrorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : ""
  if (message.includes("No profile found")) {
    return "No student profile found for that email. Ask them to sign in first."
  }
  if (message.includes("Email is required")) return "Enter a student email."
  return "Could not enroll student. Please try again."
}

function getVisibleDocumentMetadata(doc: any) {
  return [
    doc.documentType?.toUpperCase(),
    formatFileSize(doc.fileSize),
    doc.status === "ready" && doc.chunkCount !== undefined
      ? `${doc.chunkCount} chunks`
      : null,
    doc.status === "ready" && doc.processedAt
      ? `Processed ${formatProcessedAt(doc.processedAt)}`
      : null,
  ].filter(Boolean) as string[]
}

function getPublishReadiness(kb: any, documents: any[]) {
  const failedDocuments = documents.filter((doc) => doc.status === "error")
  const blockingDocuments = documents.filter(
    (doc) => doc.status === "uploading" || doc.status === "processing"
  )
  const readyDocuments = documents.filter((doc) => doc.status === "ready")

  const checklist = [
    {
      label: "Course details exist",
      done: Boolean(kb.title?.trim()),
      reason: "Add a course title.",
    },
    {
      label: "Documents uploaded",
      done: documents.length > 0,
      reason: "Upload at least one document.",
    },
    {
      label: "At least one document ready",
      done: readyDocuments.length > 0,
      reason: "Wait for at least one document to be ready.",
    },
    {
      label: "No processing is blocking publishing",
      done: blockingDocuments.length === 0,
      reason: "Wait for uploading or processing documents to finish.",
    },
  ]

  return {
    checklist,
    failedDocuments,
    canPublish: checklist.every((item) => item.done),
  }
}

function getPublishBlockedMessage(
  readiness: ReturnType<typeof getPublishReadiness>
) {
  const firstBlockedItem = readiness.checklist.find((item) => !item.done)
  return (
    firstBlockedItem?.reason ??
    "Resolve the readiness checklist before publishing."
  )
}

function getModulePath(module: any, modules: any[]): string[] {
  const path: string[] = []
  let current = module
  while (current) {
    path.unshift(current.name)
    current = current.parentId
      ? modules.find((mod) => mod._id === current.parentId)
      : null
  }
  return path
}

function getDocumentModulePath(doc: any, modules: any[]) {
  const targetModule = modules.find((mod) => mod._id === doc.moduleId)
  return targetModule
    ? getModulePath(targetModule, modules).join(" > ")
    : "Course level"
}

type DocumentChildGroup = {
  key: string
  label: string
  documents: any[]
}

type DocumentModuleGroup = {
  key: string
  label: string
  documents: any[]
  childGroups: DocumentChildGroup[]
  totalCount: number
}

function groupDocumentsByTopModule(
  documents: any[],
  modules: any[]
): DocumentModuleGroup[] {
  const moduleById = new Map(modules.map((mod) => [mod._id, mod]))
  const groups = new Map<string, DocumentModuleGroup>()

  function getTopModule(module: any) {
    let current = module
    while (current?.parentId && moduleById.has(current.parentId)) {
      current = moduleById.get(current.parentId)
    }
    return current
  }

  function getOrCreateGroup(key: string, label: string) {
    if (!groups.has(key)) {
      groups.set(key, {
        key,
        label,
        documents: [],
        childGroups: [],
        totalCount: 0,
      })
    }
    return groups.get(key)!
  }

  for (const doc of documents) {
    const targetModule = doc.moduleId ? moduleById.get(doc.moduleId) : null
    if (!targetModule) {
      const group = getOrCreateGroup("course-level", "Course-level documents")
      group.documents.push(doc)
      group.totalCount += 1
      continue
    }

    const topModule = getTopModule(targetModule)
    const group = getOrCreateGroup(topModule._id, topModule.name)
    group.totalCount += 1

    if (targetModule._id === topModule._id) {
      group.documents.push(doc)
      continue
    }

    let childGroup = group.childGroups.find(
      (child) => child.key === targetModule._id
    )
    if (!childGroup) {
      const childPath = getModulePath(targetModule, modules)
        .slice(1)
        .join(" > ")
      childGroup = {
        key: targetModule._id,
        label: childPath || targetModule.name,
        documents: [],
      }
      group.childGroups.push(childGroup)
    }
    childGroup.documents.push(doc)
  }

  return Array.from(groups.values())
    .map((group) => ({
      ...group,
      childGroups: group.childGroups.sort((a, b) =>
        a.label.localeCompare(b.label)
      ),
    }))
    .sort((a, b) => a.label.localeCompare(b.label))
}

type DocumentSummary = {
  ready: number
  processing: number
  failed: number
}

function getDocumentSummary(documents: any[]): DocumentSummary {
  return documents.reduce<DocumentSummary>(
    (summary, doc: any) => {
      if (doc.status === "ready") summary.ready += 1
      else if (doc.status === "error") summary.failed += 1
      else summary.processing += 1
      return summary
    },
    { ready: 0, processing: 0, failed: 0 }
  )
}

function getReadinessTitle(summary: {
  ready: number
  processing: number
  failed: number
}) {
  if (summary.failed > 0) return "Some documents need attention"
  if (summary.processing > 0) return "Course material is still processing"
  if (summary.ready > 0) return "Course material is ready for students"
  return "Upload documents to prepare this course"
}

function getReadinessMessage(summary: {
  ready: number
  processing: number
  failed: number
}) {
  if (summary.failed > 0) {
    return "Retry failed documents below so students can get answers from the full course."
  }
  if (summary.processing > 0) {
    return "Processing can take a little time. Ready documents are already available while the rest finish."
  }
  if (summary.ready > 0) {
    return "All uploaded documents are ready to answer student questions."
  }
  return "Upload at least one document to give the tutor course material."
}

function getReadinessClassName(summary: {
  ready: number
  processing: number
  failed: number
}) {
  if (summary.failed > 0) return "border-destructive/30 bg-destructive/5"
  if (summary.processing > 0) {
    return "border-sky-200 bg-sky-50 dark:border-sky-900/70 dark:bg-sky-950/30"
  }
  return "border-emerald-200 bg-emerald-50 dark:border-emerald-900/70 dark:bg-emerald-950/30"
}

function getStatusHelpText(doc: any) {
  if (doc.status === "ready") {
    return "Ready for student questions."
  }
  if (doc.status === "error") {
    return "This document is not available to students until it is retried successfully."
  }
  if (doc.status === "processing") {
    return "The text is being prepared for the tutor. This is normal after upload."
  }
  return "The file is being saved before processing starts."
}

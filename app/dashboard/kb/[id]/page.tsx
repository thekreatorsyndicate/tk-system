"use client"

/* eslint-disable @typescript-eslint/no-explicit-any */

import { useMutation } from "convex/react"
import { api } from "@/convex/_generated/api"
import { useAuth } from "@clerk/nextjs"
import { useStableQuery } from "@/hooks/use-stable-query"
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

  return (
    <div className="flex flex-col gap-1" style={{ marginLeft: depth * 16 }}>
      <div className="flex items-center justify-between rounded border px-3 py-2">
        <span className="text-sm">{mod.name}</span>
        <div className="flex gap-2">
          <button
            onClick={() => {
              const n = prompt("Sub-module name:")
              if (n?.trim()) onAddSub(mod._id, n.trim())
            }}
            className="text-xs text-muted-foreground hover:text-foreground"
          >
            + Sub
          </button>
          <button
            onClick={() => onRemove(mod._id)}
            className="text-xs text-destructive"
          >
            Remove
          </button>
        </div>
      </div>
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

export default function KBDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  useAuth()
  const profile = useStableQuery(api.auth.getMe)
  const kb = useStableQuery(api.knowledgeBases.get, { id: id as any })
  const documents = useStableQuery(api.documents.list, { knowledgeBaseId: id as any })
  const moduleTree = useStableQuery(api.modules.getTree, { knowledgeBaseId: id as any })
  const router = useRouter()
  const updateKB = useMutation(api.knowledgeBases.update)
  const removeKB = useMutation(api.knowledgeBases.remove)
  const createModule = useMutation(api.modules.create)
  const removeModule = useMutation(api.modules.remove)
  const generateUrl = useMutation(api.documents.generateUploadUrl)
  const createDocRecord = useMutation(api.documents.createRecord)
  const removeDoc = useMutation(api.documents.remove)
  const retryDoc = useMutation(api.documents.retryProcessing)

  const [moduleName, setModuleName] = useState("")
  const [uploadModuleId, setUploadModuleId] = useState<string>("")
  const [uploading, setUploading] = useState(false)
  const [uploadQueue, setUploadQueue] = useState<{ name: string; status: string }[]>([])
  const [dragOver, setDragOver] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  if (profile === undefined || kb === undefined || documents === undefined || moduleTree === undefined) {
    return <div className="p-8 text-sm">Loading...</div>
  }

  if (!kb) return <div className="p-8 text-sm">Knowledge base not found</div>

  const safeKb = kb

  async function handlePublish() {
    await updateKB({ id: safeKb._id, isPublished: !safeKb.isPublished })
  }

  async function handleDelete() {
    if (!confirm("Delete this knowledge base and all its content?")) return
    await removeKB({ id: safeKb._id })
    router.push("/dashboard")
  }

  async function handleAddModule() {
    if (!moduleName.trim()) return
    await createModule({ knowledgeBaseId: safeKb._id, name: moduleName.trim() })
    setModuleName("")
  }

  async function handleAddSubModule(parentId: string, name: string) {
    await createModule({ knowledgeBaseId: safeKb._id, name, parentId: parentId as any })
  }

  async function uploadFile(file: File) {
    setUploadQueue((q) => [...q, { name: file.name, status: "uploading" }])
    try {
      const { storageId: uploadUrl } = await generateUrl({
        knowledgeBaseId: safeKb._id,
        moduleId: uploadModuleId ? (uploadModuleId as any) : undefined,
        filename: file.name,
        contentType: file.type,
      })

      const uploadRes = await fetch(uploadUrl, {
        method: "POST",
        headers: { "Content-Type": file.type },
        body: file,
      })

      if (!uploadRes.ok) throw new Error("Upload failed")

      const { storageId } = await uploadRes.json()

      await createDocRecord({
        knowledgeBaseId: safeKb._id,
        moduleId: uploadModuleId ? (uploadModuleId as any) : undefined,
        storageId: storageId as any,
        filename: file.name,
        contentType: file.type,
      })

      setUploadQueue((q) =>
        q.map((item) =>
          item.name === file.name ? { ...item, status: "done" } : item,
        ),
      )
    } catch (err) {
      console.error("Upload error:", err)
      setUploadQueue((q) =>
        q.map((item) =>
          item.name === file.name ? { ...item, status: "error" } : item,
        ),
      )
    }
  }

  async function handleDrop(e: DragEvent) {
    e.preventDefault()
    setDragOver(false)
    const files = Array.from(e.dataTransfer.files)
    if (files.length === 0) return
    setUploading(true)
    for (const file of files) {
      await uploadFile(file)
    }
    setUploading(false)
  }

  function handleDragOver(e: DragEvent) {
    e.preventDefault()
    setDragOver(true)
  }

  function handleDragLeave() {
    setDragOver(false)
  }

  async function handleInputUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? [])
    if (files.length === 0) return
    setUploading(true)
    for (const file of files) {
      await uploadFile(file)
    }
    setUploading(false)
    e.target.value = ""
  }

  const flattenedModules = flattenModuleTree(moduleTree)

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-medium">{safeKb.title}</h1>
          {safeKb.description && <p className="text-sm text-muted-foreground">{safeKb.description}</p>}
        </div>
        <div className="flex gap-2">
          <button onClick={handlePublish} className="rounded border px-3 py-1.5 text-xs">
            {safeKb.isPublished ? "Unpublish" : "Publish"}
          </button>
          <button onClick={handleDelete} className="rounded border border-destructive/30 px-3 py-1.5 text-xs text-destructive">
            Delete
          </button>
        </div>
      </div>

      <div className="flex flex-col gap-3">
        <h2 className="text-sm font-medium">Modules</h2>
        {moduleTree.length === 0 ? (
          <p className="text-xs text-muted-foreground">No modules yet. Add one below.</p>
        ) : (
          <div className="flex flex-col gap-1">
            {moduleTree.map((mod: any) => (
              <ModuleTreeItem
                key={mod._id}
                mod={mod}
                depth={0}
                onRemove={(id) => removeModule({ id: id as any })}
                onAddSub={handleAddSubModule}
              />
            ))}
          </div>
        )}
        <div className="flex gap-2">
          <input
            className="flex-1 rounded border px-3 py-1.5 text-sm"
            placeholder="Module name..."
            value={moduleName}
            onChange={(e) => setModuleName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleAddModule()}
          />
          <button onClick={handleAddModule} disabled={!moduleName.trim()} className="rounded border px-3 py-1.5 text-xs disabled:opacity-50">
            Add
          </button>
        </div>
      </div>

      <div className="flex flex-col gap-3">
        <h2 className="text-sm font-medium">Upload Documents</h2>
        <div className="flex gap-2">
          <select
            className="rounded border px-3 py-1.5 text-xs"
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
        </div>
        <div
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onClick={() => fileInputRef.current?.click()}
          className={`flex cursor-pointer flex-col items-center gap-2 rounded border-2 border-dashed p-8 text-sm transition-colors ${
            dragOver
              ? "border-primary bg-primary/5"
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
              <span className="font-medium">Drop files here</span>
              <span className="text-xs text-muted-foreground">or click to browse</span>
            </>
          )}
        </div>
        {uploadQueue.length > 0 && (
          <div className="flex flex-col gap-1">
            {uploadQueue.map((item) => (
              <div key={item.name} className="flex items-center gap-2 text-xs">
                <span
                  className={
                    item.status === "done"
                      ? "text-green-600"
                      : item.status === "error"
                        ? "text-destructive"
                        : "text-muted-foreground"
                  }
                >
                  {item.status === "done" ? "✓" : item.status === "error" ? "✗" : "⋯"}
                </span>
                <span className="truncate">{item.name}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="flex flex-col gap-3">
        <h2 className="text-sm font-medium">Documents</h2>
        {documents.length === 0 ? (
          <p className="text-xs text-muted-foreground">No documents uploaded yet.</p>
        ) : (
          groupDocumentsByModule(documents, flattenedModules).map((group) => (
            <div key={group.key} className="flex flex-col gap-1.5">
              <h3 className="text-xs font-medium text-muted-foreground">
                {group.label}
              </h3>
              <div className="flex flex-col gap-2">
                {group.documents.map((doc: any) => (
                  <div key={doc._id} className="flex items-start justify-between gap-4 rounded border px-3 py-2">
                    <div className="min-w-0 flex flex-col gap-1">
                      <span className="truncate text-sm">{doc.filename}</span>
                      <span className="flex flex-wrap gap-x-2 gap-y-1 text-xs text-muted-foreground">
                        <span className={getStatusClassName(doc.status)}>
                          {formatStatus(doc.status)}
                        </span>
                        {getDocumentMetadata(doc).map((item) => (
                          <span key={item}>{item}</span>
                        ))}
                      </span>
                      {doc.errorMessage && (
                        <span className="text-xs text-destructive">
                          {doc.errorMessage}
                        </span>
                      )}
                    </div>
                    <div className="flex shrink-0 items-center gap-3">
                      {doc.status === "error" && (
                        <button
                          onClick={() => retryDoc({ id: doc._id })}
                          className="text-xs text-muted-foreground hover:text-foreground"
                        >
                          Retry
                        </button>
                      )}
                      <button onClick={() => removeDoc({ id: doc._id })} className="text-xs text-destructive">
                        Delete
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  )
}

function flattenModuleTree(modules: any[], depth = 0): any[] {
  return modules.flatMap((mod) => [
    { ...mod, depth },
    ...flattenModuleTree(mod.children ?? [], depth + 1),
  ])
}

function formatStatus(status: string) {
  return status.charAt(0).toUpperCase() + status.slice(1)
}

function getStatusClassName(status: string) {
  if (status === "ready") return "font-medium text-green-600"
  if (status === "error") return "font-medium text-destructive"
  if (status === "processing") return "font-medium text-blue-600"
  return "font-medium text-muted-foreground"
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

function getDocumentMetadata(doc: any) {
  return [
    doc.documentType?.toUpperCase(),
    formatFileSize(doc.fileSize),
    doc.chunkCount !== undefined ? `${doc.chunkCount} chunks` : null,
    doc.embeddingModel,
    doc.processedAt ? `Processed ${formatProcessedAt(doc.processedAt)}` : null,
    doc.parserVersion ? `Parser ${doc.parserVersion}` : null,
  ].filter(Boolean) as string[]
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

function groupDocumentsByModule(documents: any[], modules: any[]) {
  const groups = new Map<string, { key: string; label: string; documents: any[] }>()

  for (const doc of documents) {
    const targetModule = modules.find((mod) => mod._id === doc.moduleId)
    const key = targetModule?._id ?? "course-level"
    const label = targetModule
      ? getModulePath(targetModule, modules).join(" > ")
      : "Course-level documents"

    if (!groups.has(key)) {
      groups.set(key, { key, label, documents: [] })
    }
    groups.get(key)!.documents.push(doc)
  }

  return Array.from(groups.values()).sort((a, b) =>
    a.label.localeCompare(b.label),
  )
}

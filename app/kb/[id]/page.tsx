"use client"

/* eslint-disable @typescript-eslint/no-explicit-any */

import { useAction, useMutation } from "convex/react"
import { api } from "@/convex/_generated/api"
import { useAuth } from "@clerk/nextjs"
import { useStableQuery } from "@/hooks/use-stable-query"
import { useToast } from "@/components/toast"
import {
  ArrowLeft,
  ChatCircleText,
  TreeStructure,
  X,
} from "@phosphor-icons/react"
import { useRouter } from "next/navigation"
import { use, useState, useRef, useEffect } from "react"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"

type MobilePanel = "conversations" | "modules" | null

export default function KBChatPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = use(params)
  const { isLoaded, isSignedIn } = useAuth()
  const { showToast } = useToast()
  const router = useRouter()
  const profile = useStableQuery(api.auth.getMe)
  const hasProfile = profile !== undefined && profile !== null
  const kb = useStableQuery(api.knowledgeBases.get, { id: id as any })
  const moduleTree = useStableQuery(api.modules.getTree, {
    knowledgeBaseId: id as any,
  })
  const conversations = useStableQuery(
    api.chat.listConversations,
    hasProfile ? { knowledgeBaseId: id as any } : "skip"
  )
  const [conversationId, setConversationId] = useState<string | null>(null)
  const [pinnedModuleId, setPinnedModuleId] = useState<string | null>(null)
  const [input, setInput] = useState("")
  const [sending, setSending] = useState(false)
  const [creatingConversation, setCreatingConversation] = useState(false)
  const [creatingProfile, setCreatingProfile] = useState(false)
  const [profileSetupError, setProfileSetupError] = useState<string | null>(
    null
  )
  const [profileSetupAttempt, setProfileSetupAttempt] = useState(0)
  const [chatError, setChatError] = useState<string | null>(null)
  const [archivingConversationIds, setArchivingConversationIds] = useState<
    Set<string>
  >(() => new Set())
  const [deletingConversationIds, setDeletingConversationIds] = useState<
    Set<string>
  >(() => new Set())
  const [confirmingConversationId, setConfirmingConversationId] = useState<
    string | null
  >(null)
  const [showArchived, setShowArchived] = useState(false)
  const [mobilePanel, setMobilePanel] = useState<MobilePanel>(null)
  const [collapsedModuleIds, setCollapsedModuleIds] = useState<Set<string>>(
    () => new Set()
  )
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const createdProfileRef = useRef(false)

  const getOrCreateProfile = useMutation(api.auth.getOrCreateProfile)
  const createConv = useMutation(api.chat.createConversation)
  const archiveConv = useMutation(api.chat.archiveConversation)
  const deleteConv = useMutation(api.chat.deleteConversation)
  const sendMsg = useAction(api.chat.sendMessage)
  const messages = useStableQuery(
    api.chat.getMessages,
    conversationId ? { conversationId: conversationId as any } : "skip"
  )

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [messages])

  useEffect(() => {
    if (!isLoaded || profile === undefined) return
    if (!isSignedIn || profile !== null) {
      createdProfileRef.current = false
      return
    }
    if (createdProfileRef.current) return

    let cancelled = false
    createdProfileRef.current = true
    setCreatingProfile(true)
    setProfileSetupError(null)

    getOrCreateProfile({ role: "student" })
      .then((createdProfile) => {
        if (!createdProfile)
          throw new Error("Profile setup returned no profile")
      })
      .catch((error) => {
        if (cancelled) return
        console.error("Profile creation failed:", error)
        createdProfileRef.current = false
        const message = getErrorMessage(error)
        setProfileSetupError(message)
        showToast({
          title: "Profile setup failed",
          description: "We could not create your profile. Please try again.",
          variant: "error",
        })
      })
      .finally(() => {
        if (!cancelled) setCreatingProfile(false)
      })

    return () => {
      cancelled = true
    }
  }, [
    getOrCreateProfile,
    isLoaded,
    isSignedIn,
    profile,
    profileSetupAttempt,
    showToast,
  ])

  if (!isLoaded || kb === undefined || moduleTree === undefined) {
    return <div className="p-8 text-sm">Loading...</div>
  }

  if (!isSignedIn) {
    return (
      <div className="flex min-h-svh items-center justify-center p-8">
        <p className="text-sm text-muted-foreground">
          Sign in to start learning
        </p>
      </div>
    )
  }

  if (!kb) return <div className="p-8 text-sm">Knowledge base not found</div>

  if (profile === undefined || profile === null) {
    return (
      <div className="flex min-h-svh items-center justify-center p-8">
        <div className="flex max-w-sm flex-col items-center gap-3 text-center">
          {profileSetupError ? (
            <>
              <p className="text-sm font-medium">Profile setup failed</p>
              <p className="text-sm text-muted-foreground">
                {profileSetupError}
              </p>
              <button
                type="button"
                onClick={() => {
                  createdProfileRef.current = false
                  setProfileSetupError(null)
                  setProfileSetupAttempt((attempt) => attempt + 1)
                }}
                className="rounded bg-primary px-4 py-2 text-sm text-primary-foreground"
              >
                Try Again
              </button>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">
              {creatingProfile ? "Setting up your profile..." : "Loading..."}
            </p>
          )}
        </div>
      </div>
    )
  }

  const safeKb = kb
  const safeConversations = conversations ?? []
  const chatDisabled = sending || !hasProfile

  async function handleNewConversation() {
    if (!hasProfile || creatingConversation) return

    setChatError(null)
    setCreatingConversation(true)
    try {
      const conv = await createConv({
        knowledgeBaseId: safeKb._id,
        ...(pinnedModuleId ? { pinnedModuleId: pinnedModuleId as any } : {}),
      })
      setConversationId(conv!._id)
      setMobilePanel(null)
    } catch (error) {
      console.error("Conversation creation failed:", error)
      const message = getErrorMessage(error)
      setChatError(message)
      showToast({
        title: "Chat creation failed",
        description: "We could not start a new chat. Please try again.",
        variant: "error",
      })
    } finally {
      setCreatingConversation(false)
    }
  }

  async function handleSend(e: React.FormEvent) {
    e.preventDefault()
    if (!input.trim() || chatDisabled) return

    const messageText = input.trim()
    setChatError(null)
    setSending(true)
    try {
      let convId = conversationId
      if (!convId) {
        const conv = await createConv({
          knowledgeBaseId: safeKb._id,
          ...(pinnedModuleId ? { pinnedModuleId: pinnedModuleId as any } : {}),
        })
        convId = conv!._id
        setConversationId(convId)
      }

      await sendMsg({ conversationId: convId as any, content: messageText })
      setInput("")
    } catch (error) {
      console.error("Chat send failed:", error)
      const message = getErrorMessage(error)
      setChatError(message)
      showToast({
        title: "Message not sent",
        description:
          "Your message is still in the input. Please try sending it again.",
        variant: "error",
      })
    } finally {
      setSending(false)
    }
  }

  async function handleArchiveConversation(id: string, isActive: boolean) {
    if (archivingConversationIds.has(id)) return
    setArchivingConversationIds((current) => new Set(current).add(id))
    try {
      await archiveConv({ id: id as any, isActive })
      if (conversationId === id && !isActive) setConversationId(null)
    } catch (error) {
      console.error("Conversation archive update failed:", error)
      showToast({
        title: isActive ? "Unarchive failed" : "Archive failed",
        description: "We could not update this conversation. Please try again.",
        variant: "error",
      })
    } finally {
      setArchivingConversationIds((current) => {
        const next = new Set(current)
        next.delete(id)
        return next
      })
    }
  }

  async function handleDeleteConversation(id: string) {
    if (deletingConversationIds.has(id)) return
    setDeletingConversationIds((current) => new Set(current).add(id))
    try {
      await deleteConv({ id: id as any })
      if (conversationId === id) setConversationId(null)
      setConfirmingConversationId((current) =>
        current === id ? null : current
      )
    } catch (error) {
      console.error("Conversation deletion failed:", error)
      showToast({
        title: "Delete failed",
        description: "We could not delete this conversation. Please try again.",
        variant: "error",
      })
    } finally {
      setDeletingConversationIds((current) => {
        const next = new Set(current)
        next.delete(id)
        return next
      })
    }
  }

  function handleSelectModule(moduleId: string | null) {
    setPinnedModuleId(moduleId)
    setConversationId(null)
    setMobilePanel(null)
  }

  function handleSelectConversation(id: string) {
    setConversationId(id)
    setMobilePanel(null)
  }

  const currentConv = safeConversations.find(
    (c: any) => c._id === conversationId
  )
  const flatModules = flattenModuleTree(moduleTree)
  const selectedModuleIds = pinnedModuleId
    ? new Set([
        pinnedModuleId,
        ...getDescendantModuleIds(moduleTree, pinnedModuleId),
      ])
    : null
  const scopedConversations = selectedModuleIds
    ? safeConversations.filter(
        (conv: any) =>
          conv.pinnedModuleId && selectedModuleIds.has(conv.pinnedModuleId)
      )
    : safeConversations
  const activeConversations = scopedConversations.filter(
    (conv: any) => conv.isActive
  )
  const archivedConversations = scopedConversations.filter(
    (conv: any) => !conv.isActive
  )

  const pinnedModuleName = pinnedModuleId
    ? (flatModules.find((m: any) => m._id === pinnedModuleId)?.name ??
      "Unknown module")
    : null

  function toggleModuleExpanded(moduleId: string) {
    setCollapsedModuleIds((current) => {
      const next = new Set(current)
      if (next.has(moduleId)) {
        next.delete(moduleId)
      } else {
        next.add(moduleId)
      }
      return next
    })
  }

  const conversationsPanel = (
    <ConversationsPanel
      scopedConversations={scopedConversations}
      activeConversations={activeConversations}
      archivedConversations={archivedConversations}
      conversationId={conversationId}
      pinnedModuleId={pinnedModuleId}
      showArchived={showArchived}
      hasProfile={hasProfile}
      creatingConversation={creatingConversation}
      archivingConversationIds={archivingConversationIds}
      deletingConversationIds={deletingConversationIds}
      confirmingConversationId={confirmingConversationId}
      onNewConversation={handleNewConversation}
      onShowArchivedChange={setShowArchived}
      onArchive={handleArchiveConversation}
      onRequestDelete={setConfirmingConversationId}
      onCancelDelete={() => setConfirmingConversationId(null)}
      onConfirmDelete={handleDeleteConversation}
      onSelect={handleSelectConversation}
      onClose={() => setMobilePanel(null)}
    />
  )

  const modulesPanel = (
    <ModulesPanel
      moduleTree={moduleTree}
      pinnedModuleId={pinnedModuleId}
      collapsedModuleIds={collapsedModuleIds}
      onSelect={handleSelectModule}
      onToggle={toggleModuleExpanded}
      onClose={() => setMobilePanel(null)}
    />
  )

  return (
    <main className="flex h-[calc(100svh-4rem)] min-w-0 flex-col overflow-hidden bg-background px-3 pt-3 pb-3 sm:px-4">
      <div className="mb-3 flex h-10 shrink-0 items-center justify-between gap-3 border-b border-border/80 pb-3">
        <button
          type="button"
          onClick={() => router.push("/")}
          className="inline-flex items-center gap-2 rounded-full border border-border/80 bg-background/80 px-3 py-1 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="size-3.5" aria-hidden="true" />
          Main workspace
        </button>
      </div>
      <div className="flex min-h-0 min-w-0 flex-1 gap-3 overflow-hidden">
        <aside className="hidden w-64 shrink-0 flex-col overflow-hidden rounded-md border border-border bg-card shadow-sm shadow-black/5 lg:flex">
          {conversationsPanel}
        </aside>

        <aside className="hidden w-64 shrink-0 flex-col overflow-hidden rounded-md border border-border bg-card shadow-sm shadow-black/5 lg:flex">
          {modulesPanel}
        </aside>

        {mobilePanel && (
          <MobileDrawer onClose={() => setMobilePanel(null)}>
            {mobilePanel === "conversations"
              ? conversationsPanel
              : modulesPanel}
          </MobileDrawer>
        )}

        <section className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-md border border-border bg-card shadow-sm shadow-black/5">
          <header className="border-b border-border bg-card">
            <div className="flex min-h-14 items-center justify-between gap-3 px-3 py-2 sm:px-5">
              <div className="flex min-w-0 items-center gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 text-sm font-semibold">
                    <ChatCircleText
                      className="size-4 text-primary"
                      aria-hidden="true"
                    />
                    <h1 className="truncate">{safeKb.title}</h1>
                  </div>
                  {pinnedModuleName && (
                    <p className="mt-1 truncate text-xs text-muted-foreground">
                      Focused on: {pinnedModuleName}
                    </p>
                  )}
                  {currentConv && !pinnedModuleName && (
                    <p className="mt-1 truncate text-xs text-muted-foreground">
                      {currentConv.title}
                    </p>
                  )}
                </div>
              </div>
              <div className="flex shrink-0 gap-2 lg:hidden">
                <button
                  type="button"
                  onClick={() => setMobilePanel("conversations")}
                  className="flex h-9 items-center gap-1.5 rounded-md border border-border px-3 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                >
                  <ChatCircleText size={16} aria-hidden />
                  Chats
                </button>
                <button
                  type="button"
                  onClick={() => setMobilePanel("modules")}
                  className="flex h-9 items-center gap-1.5 rounded-md border border-border px-3 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                >
                  <TreeStructure size={16} aria-hidden />
                  Modules
                </button>
              </div>
            </div>
          </header>

          <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto bg-background/25 p-3 sm:p-5">
            {!conversationId ? (
              <div className="flex flex-1 items-center justify-center">
                <div className="flex max-w-sm flex-col items-center gap-3 rounded-md border border-dashed border-border bg-card/70 p-6 text-center">
                  <p className="text-center text-sm text-muted-foreground">
                    {pinnedModuleName
                      ? `Focused on ${pinnedModuleName}`
                      : `Ready for ${safeKb.title}`}
                  </p>
                  <button
                    type="button"
                    onClick={handleNewConversation}
                    disabled={!hasProfile || creatingConversation}
                    className="inline-flex h-9 items-center justify-center rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {creatingConversation ? "Starting..." : "Start chat"}
                  </button>
                </div>
              </div>
            ) : messages === undefined ? (
              <div className="flex flex-1 items-center justify-center">
                <p className="text-sm text-muted-foreground">
                  Loading messages...
                </p>
              </div>
            ) : messages.length === 0 ? (
              <div className="flex flex-1 items-center justify-center">
                <p className="text-sm text-muted-foreground">
                  Send a message to start the conversation
                </p>
              </div>
            ) : (
              messages.map((msg: any) => (
                <ChatMessage key={msg._id} msg={msg} />
              ))
            )}
            <div ref={messagesEndRef} />
          </div>

          {chatError && (
            <div className="border-t border-destructive/30 bg-destructive/10 px-3 py-3 text-sm text-destructive sm:px-4">
              {chatError}
            </div>
          )}

          <form
            onSubmit={handleSend}
            className="flex gap-2 border-t border-border bg-card p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:p-4"
          >
            <input
              className="h-11 min-w-0 flex-1 rounded-md border border-border bg-background px-3 text-sm transition-colors outline-none placeholder:text-muted-foreground focus:border-primary"
              placeholder="Ask a question about the course material..."
              value={input}
              onChange={(e) => setInput(e.target.value)}
              disabled={chatDisabled}
            />
            <button
              type="submit"
              disabled={!input.trim() || chatDisabled}
              className="h-11 shrink-0 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {sending ? "..." : "Send"}
            </button>
          </form>
        </section>
      </div>
    </main>
  )
}

function MobileDrawer({
  children,
  onClose,
}: {
  children: React.ReactNode
  onClose: () => void
}) {
  return (
    <div className="fixed inset-0 z-50 lg:hidden">
      <button
        type="button"
        aria-label="Close panel"
        onClick={onClose}
        className="absolute inset-0 bg-background/80"
      />
      <aside className="absolute inset-y-0 left-0 flex w-[min(22rem,calc(100vw-2rem))] max-w-full flex-col border-r border-border bg-card shadow-lg">
        {children}
      </aside>
    </div>
  )
}

function PanelHeader({
  title,
  children,
  onClose,
}: {
  title: string
  children?: React.ReactNode
  onClose?: () => void
}) {
  return (
    <div className="flex min-h-14 shrink-0 items-center justify-between gap-2 border-b border-border px-4 py-3">
      <h2 className="text-xs font-semibold tracking-[0.16em] text-muted-foreground uppercase">
        {title}
      </h2>
      <div className="flex items-center gap-1.5">
        {children}
        {onClose && (
          <button
            type="button"
            aria-label="Close panel"
            onClick={onClose}
            className="flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground lg:hidden"
          >
            <X size={16} aria-hidden />
          </button>
        )}
      </div>
    </div>
  )
}

function ConversationsPanel({
  scopedConversations,
  activeConversations,
  archivedConversations,
  conversationId,
  pinnedModuleId,
  showArchived,
  hasProfile,
  creatingConversation,
  archivingConversationIds,
  deletingConversationIds,
  confirmingConversationId,
  onNewConversation,
  onShowArchivedChange,
  onArchive,
  onRequestDelete,
  onCancelDelete,
  onConfirmDelete,
  onSelect,
  onClose,
}: {
  scopedConversations: any[]
  activeConversations: any[]
  archivedConversations: any[]
  conversationId: string | null
  pinnedModuleId: string | null
  showArchived: boolean
  hasProfile: boolean
  creatingConversation: boolean
  archivingConversationIds: Set<string>
  deletingConversationIds: Set<string>
  confirmingConversationId: string | null
  onNewConversation: () => void
  onShowArchivedChange: (value: boolean | ((value: boolean) => boolean)) => void
  onArchive: (id: string, isActive: boolean) => void
  onRequestDelete: (id: string) => void
  onCancelDelete: () => void
  onConfirmDelete: (id: string) => void
  onSelect: (id: string) => void
  onClose: () => void
}) {
  return (
    <>
      <PanelHeader title="Conversations" onClose={onClose}>
        <button
          type="button"
          onClick={onNewConversation}
          disabled={!hasProfile || creatingConversation}
          className="rounded-md px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
        >
          {creatingConversation ? "Starting..." : "+ New"}
        </button>
      </PanelHeader>
      <div className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto p-3">
        {scopedConversations.length === 0 ? (
          <p className="px-2 py-2 text-xs text-muted-foreground">
            {pinnedModuleId
              ? "No conversations in this module"
              : "No conversations yet"}
          </p>
        ) : (
          <>
            <ConversationList
              conversations={activeConversations}
              conversationId={conversationId}
              emptyLabel={
                pinnedModuleId
                  ? "No active conversations in this module"
                  : "No active conversations"
              }
              onArchive={(id) => onArchive(id, false)}
              onRequestDelete={onRequestDelete}
              onCancelDelete={onCancelDelete}
              onConfirmDelete={onConfirmDelete}
              onSelect={onSelect}
              archivingIds={archivingConversationIds}
              deletingIds={deletingConversationIds}
              confirmingId={confirmingConversationId}
            />
            {showArchived && archivedConversations.length > 0 && (
              <div className="mt-3 border-t border-border pt-3">
                <p className="px-2 pb-1 text-[10px] tracking-wider text-muted-foreground uppercase">
                  Archived
                </p>
                <ConversationList
                  conversations={archivedConversations}
                  conversationId={conversationId}
                  emptyLabel="No archived conversations"
                  onArchive={(id) => onArchive(id, true)}
                  onRequestDelete={onRequestDelete}
                  onCancelDelete={onCancelDelete}
                  onConfirmDelete={onConfirmDelete}
                  onSelect={onSelect}
                  archivingIds={archivingConversationIds}
                  deletingIds={deletingConversationIds}
                  confirmingId={confirmingConversationId}
                  archived
                />
              </div>
            )}
          </>
        )}
      </div>
      {archivedConversations.length > 0 && (
        <div className="border-t border-border p-3">
          <button
            type="button"
            onClick={() => onShowArchivedChange((value) => !value)}
            className="min-h-11 w-full rounded-md px-2 py-2 text-left text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground lg:min-h-0 lg:py-1.5"
          >
            {showArchived
              ? "Hide archived conversations"
              : `Show archived conversations (${archivedConversations.length})`}
          </button>
        </div>
      )}
    </>
  )
}

function ModulesPanel({
  moduleTree,
  pinnedModuleId,
  collapsedModuleIds,
  onSelect,
  onToggle,
  onClose,
}: {
  moduleTree: any[]
  pinnedModuleId: string | null
  collapsedModuleIds: Set<string>
  onSelect: (id: string | null) => void
  onToggle: (id: string) => void
  onClose: () => void
}) {
  return (
    <>
      <PanelHeader title="Modules" onClose={onClose} />
      <div className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto p-3">
        <button
          type="button"
          onClick={() => onSelect(null)}
          className={`min-h-11 rounded-md px-2 py-2 text-left text-sm transition-colors lg:min-h-0 lg:py-1.5 ${
            pinnedModuleId === null ? "bg-muted font-medium" : "hover:bg-muted"
          }`}
        >
          All Modules
        </button>
        {moduleTree.length === 0 && (
          <p className="px-2 py-2 text-xs text-muted-foreground">
            No modules defined yet
          </p>
        )}
        {moduleTree.map((mod: any) => (
          <ModuleTreeItem
            key={mod._id}
            mod={mod}
            activeModuleId={pinnedModuleId}
            collapsedModuleIds={collapsedModuleIds}
            onSelect={onSelect}
            onToggle={onToggle}
          />
        ))}
      </div>
    </>
  )
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Something went wrong"
}

function flattenModuleTree(modules: any[], depth = 0): any[] {
  return modules.flatMap((mod) => [
    { ...mod, depth },
    ...flattenModuleTree(mod.children ?? [], depth + 1),
  ])
}

function ModuleTreeItem({
  mod,
  activeModuleId,
  collapsedModuleIds,
  onSelect,
  onToggle,
}: {
  mod: any
  activeModuleId: string | null
  collapsedModuleIds: Set<string>
  onSelect: (id: string) => void
  onToggle: (id: string) => void
}) {
  const children = mod.children ?? []
  const hasChildren = children.length > 0
  const isExpanded = hasChildren && !collapsedModuleIds.has(mod._id)

  return (
    <div className="flex flex-col gap-0.5">
      <div
        className={`flex items-center rounded-md transition-colors ${
          activeModuleId === mod._id ? "bg-muted font-medium" : "hover:bg-muted"
        }`}
      >
        <button
          type="button"
          onClick={() => hasChildren && onToggle(mod._id)}
          aria-label={isExpanded ? "Hide submodules" : "Show submodules"}
          className="flex h-11 w-11 shrink-0 items-center justify-center text-[11px] text-muted-foreground hover:text-foreground disabled:opacity-30 lg:h-7 lg:w-10"
          disabled={!hasChildren}
        >
          {hasChildren ? (isExpanded ? "[-]" : "[+]") : ""}
        </button>
        <button
          type="button"
          onClick={() => onSelect(mod._id)}
          className="min-h-11 min-w-0 flex-1 truncate py-2 pr-2 text-left text-sm lg:min-h-0 lg:py-1"
        >
          {mod.name}
        </button>
      </div>
      {hasChildren && isExpanded && (
        <div className="ml-4 flex flex-col gap-1 border-l border-border pl-2">
          {children.map((child: any) => (
            <ModuleTreeItem
              key={child._id}
              mod={child}
              activeModuleId={activeModuleId}
              collapsedModuleIds={collapsedModuleIds}
              onSelect={onSelect}
              onToggle={onToggle}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function getDescendantModuleIds(modules: any[], moduleId: string): string[] {
  const descendants: string[] = []
  const target = findModuleById(modules, moduleId)
  if (!target) return descendants

  function collect(children: any[]) {
    for (const child of children) {
      descendants.push(child._id)
      collect(child.children ?? [])
    }
  }

  collect(target.children ?? [])
  return descendants
}

function findModuleById(modules: any[], moduleId: string): any | null {
  for (const mod of modules) {
    if (mod._id === moduleId) return mod
    const child = findModuleById(mod.children ?? [], moduleId)
    if (child) return child
  }
  return null
}

function ChatMessage({ msg }: { msg: any }) {
  const isUser = msg.role === "user"

  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        className={`min-w-0 overflow-hidden text-sm leading-relaxed break-words ${
          isUser
            ? "max-w-[min(38rem,88%)] rounded-md bg-primary px-4 py-2 text-primary-foreground"
            : "w-full max-w-[min(52rem,100%)] rounded-md border border-border bg-card px-4 py-3 text-foreground shadow-sm shadow-black/5"
        }`}
      >
        <MarkdownContent
          content={msg.content}
          variant={isUser ? "user" : "assistant"}
        />
        {!isUser && msg.sourceChunks?.length > 0 && (
          <CourseSources sources={msg.sourceChunks} />
        )}
      </div>
    </div>
  )
}

function MarkdownContent({
  content,
  variant = "assistant",
}: {
  content: string
  variant?: "assistant" | "user" | "source"
}) {
  const isUser = variant === "user"
  const isSource = variant === "source"

  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        p: ({ children }) => (
          <p className={isSource ? "mb-1 last:mb-0" : "mb-3 last:mb-0"}>
            {children}
          </p>
        ),
        h1: ({ children }) => (
          <h1 className="mt-4 mb-2 text-base font-semibold first:mt-0">
            {children}
          </h1>
        ),
        h2: ({ children }) => (
          <h2 className="mt-4 mb-2 text-sm font-semibold first:mt-0">
            {children}
          </h2>
        ),
        h3: ({ children }) => (
          <h3 className="mt-3 mb-1.5 text-sm font-semibold first:mt-0">
            {children}
          </h3>
        ),
        ul: ({ children }) => (
          <ul className="mb-3 ml-4 list-disc space-y-1 last:mb-0">
            {children}
          </ul>
        ),
        ol: ({ children }) => (
          <ol className="mb-3 ml-4 list-decimal space-y-1 last:mb-0">
            {children}
          </ol>
        ),
        li: ({ children }) => <li className="pl-1">{children}</li>,
        input: (props) => (
          <input {...props} className="mr-2 align-[-0.125em] accent-primary" />
        ),
        strong: ({ children }) => (
          <strong className="font-semibold">{children}</strong>
        ),
        em: ({ children }) => <em className="italic">{children}</em>,
        del: ({ children }) => (
          <del className="text-muted-foreground">{children}</del>
        ),
        a: ({ children, href }) => (
          <a
            href={href}
            target="_blank"
            rel="noreferrer"
            className={
              isUser
                ? "underline decoration-primary-foreground/50 underline-offset-4 hover:decoration-primary-foreground"
                : "font-medium text-primary underline decoration-primary/30 underline-offset-4 hover:decoration-primary"
            }
          >
            {children}
          </a>
        ),
        blockquote: ({ children }) => (
          <blockquote
            className={`mb-3 border-l-2 py-0.5 pl-3 last:mb-0 ${
              isUser
                ? "border-primary-foreground/50 text-primary-foreground/85"
                : "border-primary/40 text-muted-foreground"
            }`}
          >
            {children}
          </blockquote>
        ),
        code: ({ children, className }) => {
          const text = String(children)
          const isBlock =
            /language-/.test(className ?? "") || text.includes("\n")

          return (
            <code
              className={
                isBlock
                  ? "block min-w-full overflow-x-auto rounded border border-border/70 bg-background px-3 py-2 text-xs leading-relaxed whitespace-pre text-foreground"
                  : `rounded px-1 py-0.5 text-[0.85em] ${
                      isUser
                        ? "bg-primary-foreground/15 text-primary-foreground"
                        : "bg-background text-foreground"
                    }`
              }
            >
              {children}
            </code>
          )
        },
        pre: ({ children }) => (
          <pre className="mb-3 max-w-full overflow-x-auto last:mb-0">
            {children}
          </pre>
        ),
        table: ({ children }) => (
          <div className="mb-3 max-w-full overflow-x-auto rounded border border-border/70 last:mb-0">
            <table className="w-full min-w-[32rem] border-collapse text-left text-xs">
              {children}
            </table>
          </div>
        ),
        thead: ({ children }) => (
          <thead className="bg-background/70">{children}</thead>
        ),
        th: ({ children }) => (
          <th className="border-b border-border/70 px-3 py-2 font-semibold">
            {children}
          </th>
        ),
        td: ({ children }) => (
          <td className="border-b border-border/50 px-3 py-2 align-top">
            {children}
          </td>
        ),
        img: ({ alt, src }) => {
          const imageHref = typeof src === "string" ? src : undefined

          return imageHref ? (
            <a
              href={imageHref}
              target="_blank"
              rel="noreferrer"
              className={
                isUser
                  ? "underline decoration-primary-foreground/50 underline-offset-4 hover:decoration-primary-foreground"
                  : "font-medium text-primary underline decoration-primary/30 underline-offset-4 hover:decoration-primary"
              }
            >
              {alt || "Open image"}
            </a>
          ) : null
        },
        hr: () => <hr className="my-4 border-border/70" />,
      }}
    >
      {content}
    </ReactMarkdown>
  )
}

function CourseSources({ sources }: { sources: any[] }) {
  return (
    <div className="mt-4 border-t border-border/60 pt-3">
      <p className="mb-2 text-[10px] tracking-wider text-muted-foreground uppercase">
        Course Sources
      </p>
      <div className="flex flex-col gap-2">
        {sources.map((source: any, index: number) => {
          const supportLabel = getSourceSupportLabel(source)
          return (
            <div
              key={source.chunkId}
              className="min-w-0 overflow-hidden rounded-md border border-border/70 bg-background/50 px-3 py-2 text-xs text-muted-foreground"
            >
              <div className="mb-1.5 flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className="font-medium text-foreground">
                  [{source.sourceNumber ?? index + 1}]
                </span>
                <span className="min-w-0 font-medium break-words text-foreground">
                  {source.modulePath?.length > 0
                    ? source.modulePath.join(" > ")
                    : "Course-level material"}
                </span>
                <span className="rounded border border-border/70 px-1.5 py-0.5 text-[10px] uppercase">
                  {supportLabel}
                </span>
              </div>
              {source.headingPath?.length > 0 && (
                <p className="mb-1.5 text-[11px] text-muted-foreground">
                  {source.headingPath.join(" > ")}
                </p>
              )}
              {source.supportReason && (
                <p className="mb-1.5 text-[11px] text-muted-foreground">
                  {source.supportReason}
                </p>
              )}
              <div className="min-w-0 text-xs leading-relaxed">
                <MarkdownContent content={source.content} variant="source" />
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function getSourceSupportLabel(source: any) {
  if (source.sourceKind === "adjacent") return "background context"
  if (source.supportKind === "indirect") return "indirect support"
  if (source.supportKind === "background") return "background context"
  return "direct support"
}

function ConversationList({
  conversations,
  conversationId,
  emptyLabel,
  onArchive,
  onRequestDelete,
  onCancelDelete,
  onConfirmDelete,
  onSelect,
  archivingIds,
  deletingIds,
  confirmingId,
  archived = false,
}: {
  conversations: any[]
  conversationId: string | null
  emptyLabel: string
  onArchive: (id: string) => void
  onRequestDelete: (id: string) => void
  onCancelDelete: () => void
  onConfirmDelete: (id: string) => void
  onSelect: (id: string) => void
  archivingIds: Set<string>
  deletingIds: Set<string>
  confirmingId: string | null
  archived?: boolean
}) {
  if (conversations.length === 0) {
    return (
      <p className="px-2 py-2 text-xs text-muted-foreground">{emptyLabel}</p>
    )
  }

  return (
    <div className="flex flex-col gap-1">
      {conversations.map((conv: any) => {
        const isArchiving = archivingIds.has(conv._id)
        const isDeleting = deletingIds.has(conv._id)
        const isBusy = isArchiving || isDeleting
        const isConfirmingDelete = confirmingId === conv._id

        return (
          <div
            key={conv._id}
            className={`group rounded-md border border-transparent transition-colors ${
              conversationId === conv._id ? "bg-muted" : "hover:bg-muted"
            }`}
          >
            <button
              type="button"
              onClick={() => onSelect(conv._id)}
              className="flex min-h-14 w-full flex-col justify-center gap-0.5 px-2 py-2 text-left text-xs lg:min-h-0 lg:py-2"
            >
              <span className="truncate font-medium">{conv.title}</span>
              {conv.modulePath?.length > 0 ? (
                <span className="truncate text-[10px] text-muted-foreground">
                  {conv.modulePath.join(" > ")}
                </span>
              ) : (
                <span className="truncate text-[10px] text-muted-foreground">
                  All Modules
                </span>
              )}
              <span className="text-[10px] text-muted-foreground">
                {new Date(conv._creationTime).toLocaleDateString()}
              </span>
            </button>
            <div className="flex gap-2 px-2 pb-1">
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation()
                  onArchive(conv._id)
                }}
                disabled={isBusy}
                className="min-h-9 rounded pr-2 text-[10px] text-muted-foreground opacity-80 group-hover:opacity-100 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40 lg:min-h-0"
              >
                {isArchiving ? "Saving..." : archived ? "Unarchive" : "Archive"}
              </button>
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation()
                  onRequestDelete(conv._id)
                }}
                disabled={isBusy}
                className="min-h-9 rounded px-2 text-[10px] text-destructive opacity-80 group-hover:opacity-100 hover:text-destructive disabled:cursor-not-allowed disabled:opacity-40 lg:min-h-0"
              >
                {isDeleting ? "Deleting..." : "Delete"}
              </button>
            </div>
            {isConfirmingDelete && (
              <div className="mx-2 mb-2 rounded-md border border-destructive/30 bg-destructive/5 p-2">
                <p className="text-[11px] font-medium text-destructive">
                  Delete this conversation?
                </p>
                <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
                  This permanently removes the chat and its messages. This
                  cannot be undone.
                </p>
                <div className="mt-2 flex gap-2">
                  <button
                    type="button"
                    onClick={onCancelDelete}
                    disabled={isDeleting}
                    className="min-h-9 rounded border px-2 text-[10px] text-muted-foreground hover:text-foreground disabled:opacity-50 lg:min-h-0 lg:py-1"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={() => onConfirmDelete(conv._id)}
                    disabled={isDeleting}
                    className="min-h-9 rounded border border-destructive/40 px-2 text-[10px] text-destructive hover:bg-destructive/10 disabled:cursor-not-allowed disabled:opacity-50 lg:min-h-0 lg:py-1"
                  >
                    {isDeleting ? "Deleting..." : "Delete conversation"}
                  </button>
                </div>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

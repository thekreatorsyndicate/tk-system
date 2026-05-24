"use client"

/* eslint-disable @typescript-eslint/no-explicit-any */

import { useAction, useMutation } from "convex/react"
import { api } from "@/convex/_generated/api"
import { useAuth } from "@clerk/nextjs"
import { useStableQuery } from "@/hooks/use-stable-query"
import { use, useState, useRef, useEffect } from "react"

export default function KBChatPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const { isLoaded, isSignedIn } = useAuth()
  const kb = useStableQuery(api.knowledgeBases.get, { id: id as any })
  const moduleTree = useStableQuery(api.modules.getTree, { knowledgeBaseId: id as any })
  const conversations = useStableQuery(api.chat.listConversations, { knowledgeBaseId: id as any })
  const [conversationId, setConversationId] = useState<string | null>(null)
  const [pinnedModuleId, setPinnedModuleId] = useState<string | null>(null)
  const [input, setInput] = useState("")
  const [sending, setSending] = useState(false)
  const [showSidebar, setShowSidebar] = useState(true)
  const [showArchived, setShowArchived] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)

  const createConv = useMutation(api.chat.createConversation)
  const archiveConv = useMutation(api.chat.archiveConversation)
  const deleteConv = useMutation(api.chat.deleteConversation)
  const sendMsg = useAction(api.chat.sendMessage)
  const messages = useStableQuery(
    api.chat.getMessages,
    conversationId ? { conversationId: conversationId as any } : "skip",
  )

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [messages])

  if (!isLoaded || kb === undefined || moduleTree === undefined) {
    return <div className="p-8 text-sm">Loading...</div>
  }

  if (!isSignedIn) {
    return (
      <div className="flex min-h-svh items-center justify-center p-8">
        <p className="text-sm text-muted-foreground">Sign in to start learning</p>
      </div>
    )
  }

  if (!kb) return <div className="p-8 text-sm">Knowledge base not found</div>

  const safeKb = kb
  const safeConversations = conversations ?? []

  async function handleNewConversation() {
    const conv = await createConv({
      knowledgeBaseId: safeKb._id,
      ...(pinnedModuleId ? { pinnedModuleId: pinnedModuleId as any } : {}),
    })
    setConversationId(conv!._id)
  }

  async function handleSend(e: React.FormEvent) {
    e.preventDefault()
    if (!input.trim() || sending) return

    let convId = conversationId
    if (!convId) {
      const conv = await createConv({
        knowledgeBaseId: safeKb._id,
        ...(pinnedModuleId ? { pinnedModuleId: pinnedModuleId as any } : {}),
      })
      convId = conv!._id
      setConversationId(convId)
    }

    setSending(true)
    try {
      await sendMsg({ conversationId: convId as any, content: input.trim() })
      setInput("")
    } finally {
      setSending(false)
    }
  }

  function handleSelectModule(moduleId: string | null) {
    setPinnedModuleId(moduleId)
    setConversationId(null)
  }

  function handleSelectConversation(id: string) {
    setConversationId(id)
  }

  const currentConv = safeConversations.find((c: any) => c._id === conversationId)
  const flatModules = flattenModuleTree(moduleTree)
  const activeConversations = safeConversations.filter((conv: any) => conv.isActive)
  const archivedConversations = safeConversations.filter((conv: any) => !conv.isActive)

  const pinnedModuleName = pinnedModuleId
    ? flatModules.find((m: any) => m._id === pinnedModuleId)?.name ??
      "Unknown module"
    : null

  return (
    <div className="flex h-[calc(100svh-4rem)]">
      {showSidebar && (
        <aside className="flex w-56 flex-col border-r">
          <div className="flex items-center justify-between border-b px-3 py-2">
            <h2 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Conversations
            </h2>
            <button
              onClick={handleNewConversation}
              className="text-xs text-muted-foreground hover:text-foreground"
            >
              + New
            </button>
          </div>
          <div className="flex flex-1 flex-col gap-0.5 overflow-y-auto p-2">
            {safeConversations.length === 0 ? (
              <p className="px-2 text-xs text-muted-foreground">No conversations yet</p>
            ) : (
              <>
                <ConversationList
                  conversations={activeConversations}
                  conversationId={conversationId}
                  emptyLabel="No active conversations"
                  onArchive={(id) => {
                    if (conversationId === id) setConversationId(null)
                    archiveConv({ id: id as any, isActive: false })
                  }}
                  onDelete={(id) => {
                    if (!confirm("Delete this conversation permanently?")) return
                    if (conversationId === id) setConversationId(null)
                    deleteConv({ id: id as any })
                  }}
                  onSelect={handleSelectConversation}
                />
                {showArchived && archivedConversations.length > 0 && (
                  <div className="mt-3 border-t pt-2">
                    <p className="px-2 pb-1 text-[10px] uppercase tracking-wider text-muted-foreground">
                      Archived
                    </p>
                    <ConversationList
                      conversations={archivedConversations}
                      conversationId={conversationId}
                      emptyLabel="No archived conversations"
                      onArchive={(id) =>
                        archiveConv({ id: id as any, isActive: true })
                      }
                      onDelete={(id) => {
                        if (!confirm("Delete this conversation permanently?")) return
                        if (conversationId === id) setConversationId(null)
                        deleteConv({ id: id as any })
                      }}
                      onSelect={handleSelectConversation}
                      archived
                    />
                  </div>
                )}
              </>
            )}
          </div>
          {archivedConversations.length > 0 && (
            <div className="border-t p-2">
              <button
                onClick={() => setShowArchived((value) => !value)}
                className="w-full rounded px-2 py-1.5 text-left text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                {showArchived
                  ? "Hide archived conversations"
                  : `Show archived conversations (${archivedConversations.length})`}
              </button>
            </div>
          )}
        </aside>
      )}

      <aside className="flex w-56 flex-col gap-2 overflow-y-auto border-r p-4">
        <div className="flex items-center justify-between">
          <h2 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Modules
          </h2>
          <button
            onClick={() => setShowSidebar(!showSidebar)}
            className="text-xs text-muted-foreground hover:text-foreground"
          >
            {showSidebar ? "Hide" : "Show"}
          </button>
        </div>
        <button
          onClick={() => handleSelectModule(null)}
          className={`rounded px-2 py-1 text-left text-sm transition-colors ${
            pinnedModuleId === null ? "bg-muted font-medium" : "hover:bg-muted"
          }`}
        >
          All Modules
        </button>
        {moduleTree.length === 0 && (
          <p className="text-xs text-muted-foreground">No modules defined yet</p>
        )}
        {flatModules.map((mod: any) => (
          <button
            key={mod._id}
            onClick={() => handleSelectModule(mod._id)}
            className={`w-full rounded px-2 py-1 text-left text-sm transition-colors ${
              pinnedModuleId === mod._id ? "bg-muted font-medium" : "hover:bg-muted"
            }`}
            style={{ paddingLeft: `${0.5 + mod.depth * 0.75}rem` }}
          >
            {mod.name}
          </button>
        ))}
      </aside>

      <main className="flex flex-1 flex-col">
        <header className="flex items-center justify-between border-b px-6 py-3">
          <div>
            <h1 className="text-sm font-medium">{safeKb.title}</h1>
            {pinnedModuleName && (
              <p className="text-xs text-muted-foreground">
                Focused on: {pinnedModuleName}
              </p>
            )}
            {currentConv && !pinnedModuleName && (
              <p className="text-xs text-muted-foreground">{currentConv.title}</p>
            )}
          </div>
        </header>

        <div className="flex flex-1 flex-col gap-4 overflow-y-auto p-6">
          {!conversationId ? (
            <div className="flex flex-1 items-center justify-center">
              <div className="flex flex-col items-center gap-3">
                <p className="text-center text-sm text-muted-foreground">
                  Ask a question about{" "}
                  <span className="font-medium text-foreground">{safeKb.title}</span>
                  {pinnedModuleName ? " (filtered to the selected module)" : " to get started"}
                </p>
                <button
                  onClick={handleNewConversation}
                  className="rounded bg-primary px-4 py-2 text-sm text-primary-foreground"
                >
                  Start New Chat
                </button>
              </div>
            </div>
          ) : messages === undefined ? (
            <div className="flex flex-1 items-center justify-center">
              <p className="text-sm text-muted-foreground">Loading messages...</p>
            </div>
          ) : messages.length === 0 ? (
            <div className="flex flex-1 items-center justify-center">
              <p className="text-sm text-muted-foreground">Send a message to start the conversation</p>
            </div>
          ) : (
            messages.map((msg: any) => (
              <div key={msg._id} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                <div
                  className={`max-w-[70%] rounded-lg px-4 py-2 text-sm leading-relaxed ${
                    msg.role === "user" ? "bg-primary text-primary-foreground" : "bg-muted"
                  }`}
                >
                  {msg.content}
                  {msg.role === "assistant" && msg.sourceChunks?.length > 0 && (
                    <div className="mt-3 border-t border-border/60 pt-2">
                      <p className="mb-1 text-[10px] uppercase tracking-wider text-muted-foreground">
                        Sources
                      </p>
                      <div className="flex flex-col gap-1.5">
                        {msg.sourceChunks.map((source: any, index: number) => (
                          <div
                            key={source.chunkId}
                            className="rounded border border-border/60 px-2 py-1 text-xs text-muted-foreground"
                          >
                            <span className="font-medium text-foreground">
                              {index + 1}.{" "}
                            </span>
                            {source.modulePath?.length > 0 && (
                              <span className="mr-1 font-medium text-foreground">
                                {source.modulePath.join(" > ")}:
                              </span>
                            )}
                            {source.content}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            ))
          )}
          <div ref={messagesEndRef} />
        </div>

        <form onSubmit={handleSend} className="flex gap-2 border-t p-4">
          <input
            className="flex-1 rounded border px-3 py-2 text-sm"
            placeholder="Ask a question about the course material..."
            value={input}
            onChange={(e) => setInput(e.target.value)}
            disabled={sending}
          />
          <button
            type="submit"
            disabled={!input.trim() || sending}
            className="rounded bg-primary px-4 py-2 text-sm text-primary-foreground disabled:opacity-50"
          >
            {sending ? "..." : "Send"}
          </button>
        </form>
      </main>
    </div>
  )
}

function flattenModuleTree(modules: any[], depth = 0): any[] {
  return modules.flatMap((mod) => [
    { ...mod, depth },
    ...flattenModuleTree(mod.children ?? [], depth + 1),
  ])
}

function ConversationList({
  conversations,
  conversationId,
  emptyLabel,
  onArchive,
  onDelete,
  onSelect,
  archived = false,
}: {
  conversations: any[]
  conversationId: string | null
  emptyLabel: string
  onArchive: (id: string) => void
  onDelete: (id: string) => void
  onSelect: (id: string) => void
  archived?: boolean
}) {
  if (conversations.length === 0) {
    return <p className="px-2 text-xs text-muted-foreground">{emptyLabel}</p>
  }

  return (
    <div className="flex flex-col gap-0.5">
      {conversations.map((conv: any) => (
        <div
          key={conv._id}
          className={`group rounded transition-colors ${
            conversationId === conv._id ? "bg-muted" : "hover:bg-muted"
          }`}
        >
          <button
            onClick={() => onSelect(conv._id)}
            className="flex w-full flex-col gap-0.5 px-2 py-1.5 text-left text-xs"
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
              onClick={(event) => {
                event.stopPropagation()
                onArchive(conv._id)
              }}
              className="text-[10px] text-muted-foreground opacity-70 hover:text-foreground group-hover:opacity-100"
            >
              {archived ? "Unarchive" : "Archive"}
            </button>
            <button
              onClick={(event) => {
                event.stopPropagation()
                onDelete(conv._id)
              }}
              className="text-[10px] text-destructive opacity-70 hover:text-destructive group-hover:opacity-100"
            >
              Delete
            </button>
          </div>
        </div>
      ))}
    </div>
  )
}

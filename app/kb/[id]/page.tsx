"use client"

/* eslint-disable @typescript-eslint/no-explicit-any */

import { useAction, useMutation } from "convex/react"
import { api } from "@/convex/_generated/api"
import { useAuth } from "@clerk/nextjs"
import { useStableQuery } from "@/hooks/use-stable-query"
import { use, useState, useRef, useEffect } from "react"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"

export default function KBChatPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = use(params)
  const { isLoaded, isSignedIn } = useAuth()
  const kb = useStableQuery(api.knowledgeBases.get, { id: id as any })
  const moduleTree = useStableQuery(api.modules.getTree, {
    knowledgeBaseId: id as any,
  })
  const conversations = useStableQuery(api.chat.listConversations, {
    knowledgeBaseId: id as any,
  })
  const [conversationId, setConversationId] = useState<string | null>(null)
  const [pinnedModuleId, setPinnedModuleId] = useState<string | null>(null)
  const [input, setInput] = useState("")
  const [sending, setSending] = useState(false)
  const [showArchived, setShowArchived] = useState(false)
  const [collapsedModuleIds, setCollapsedModuleIds] = useState<Set<string>>(
    () => new Set()
  )
  const messagesEndRef = useRef<HTMLDivElement>(null)

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

  return (
    <div className="flex h-[calc(100svh-4rem)]">
      <aside className="flex w-56 flex-col border-r">
        <div className="flex items-center justify-between border-y px-3 py-2">
          <h2 className="text-xs font-medium tracking-wider text-muted-foreground uppercase">
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
          {scopedConversations.length === 0 ? (
            <p className="px-2 text-xs text-muted-foreground">
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
                  <p className="px-2 pb-1 text-[10px] tracking-wider text-muted-foreground uppercase">
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
                      if (!confirm("Delete this conversation permanently?"))
                        return
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

      <aside className="flex w-56 flex-col overflow-y-auto border-r">
        <div className="flex items-center justify-between border-y px-3 py-2">
          <h2 className="text-xs font-medium tracking-wider text-muted-foreground uppercase">
            Modules
          </h2>
        </div>
        <div className="flex flex-col gap-0.5 p-2">
          <button
            onClick={() => handleSelectModule(null)}
            className={`rounded px-2 py-1 text-left text-sm transition-colors ${
              pinnedModuleId === null
                ? "bg-muted font-medium"
                : "hover:bg-muted"
            }`}
          >
            All Modules
          </button>
          {moduleTree.length === 0 && (
            <p className="px-2 text-xs text-muted-foreground">
              No modules defined yet
            </p>
          )}
          {moduleTree.map((mod: any) => (
            <ModuleTreeItem
              key={mod._id}
              mod={mod}
              activeModuleId={pinnedModuleId}
              collapsedModuleIds={collapsedModuleIds}
              onSelect={handleSelectModule}
              onToggle={toggleModuleExpanded}
            />
          ))}
        </div>
      </aside>

      <main className="flex flex-1 flex-col">
        <header className="flex items-center justify-between border-y px-6 py-3">
          <div className="min-w-0">
            <h1 className="truncate text-sm font-medium">{safeKb.title}</h1>
            {pinnedModuleName && (
              <p className="text-xs text-muted-foreground">
                Focused on: {pinnedModuleName}
              </p>
            )}
            {currentConv && !pinnedModuleName && (
              <p className="text-xs text-muted-foreground">
                {currentConv.title}
              </p>
            )}
          </div>
        </header>

        <div className="flex flex-1 flex-col gap-4 overflow-y-auto p-6">
          {!conversationId ? (
            <div className="flex flex-1 items-center justify-center">
              <div className="flex flex-col items-center gap-3">
                <p className="text-center text-sm text-muted-foreground">
                  Ask a question about{" "}
                  <span className="font-medium text-foreground">
                    {safeKb.title}
                  </span>
                  {pinnedModuleName
                    ? " (filtered to the selected module)"
                    : " to get started"}
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
            messages.map((msg: any) => <ChatMessage key={msg._id} msg={msg} />)
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
        className={`flex items-center rounded transition-colors ${
          activeModuleId === mod._id ? "bg-muted font-medium" : "hover:bg-muted"
        }`}
      >
        <button
          type="button"
          onClick={() => hasChildren && onToggle(mod._id)}
          aria-label={isExpanded ? "Hide submodules" : "Show submodules"}
          className="flex h-7 w-10 shrink-0 items-center justify-center text-[11px] text-muted-foreground hover:text-foreground disabled:opacity-30"
          disabled={!hasChildren}
        >
          {hasChildren ? (isExpanded ? "[-]" : "[+]") : ""}
        </button>
        <button
          onClick={() => onSelect(mod._id)}
          className="min-w-0 flex-1 truncate py-1 pr-2 text-left text-sm"
        >
          {mod.name}
        </button>
      </div>
      {hasChildren && isExpanded && (
        <div className="ml-4 flex flex-col gap-0.5 border-l pl-2">
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
        className={`min-w-0 text-sm leading-relaxed ${
          isUser
            ? "max-w-[min(38rem,88%)] rounded-lg bg-primary px-4 py-2 text-primary-foreground"
            : "w-full max-w-[min(52rem,100%)] rounded-lg bg-muted px-4 py-3 text-foreground"
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
        {sources.map((source: any, index: number) => (
          <div
            key={source.chunkId}
            className="rounded border border-border/70 bg-background/50 px-3 py-2 text-xs text-muted-foreground"
          >
            <div className="mb-1.5 flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="font-medium text-foreground">
                [{source.sourceNumber ?? index + 1}]
              </span>
              <span className="font-medium text-foreground">
                {source.modulePath?.length > 0
                  ? source.modulePath.join(" > ")
                  : "Course-level material"}
              </span>
              {source.sourceKind === "adjacent" && (
                <span className="rounded border border-border/70 px-1.5 py-0.5 text-[10px] uppercase">
                  supporting context
                </span>
              )}
            </div>
            {source.headingPath?.length > 0 && (
              <p className="mb-1.5 text-[11px] text-muted-foreground">
                {source.headingPath.join(" > ")}
              </p>
            )}
            <div className="text-xs leading-relaxed">
              <MarkdownContent content={source.content} variant="source" />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
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
              className="text-[10px] text-muted-foreground opacity-70 group-hover:opacity-100 hover:text-foreground"
            >
              {archived ? "Unarchive" : "Archive"}
            </button>
            <button
              onClick={(event) => {
                event.stopPropagation()
                onDelete(conv._id)
              }}
              className="text-[10px] text-destructive opacity-70 group-hover:opacity-100 hover:text-destructive"
            >
              Delete
            </button>
          </div>
        </div>
      ))}
    </div>
  )
}

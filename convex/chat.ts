/* eslint-disable @typescript-eslint/no-explicit-any */

import { v } from "convex/values"
import { action, mutation, query } from "./_generated/server"
import { internal } from "./_generated/api"
import type { Id } from "./_generated/dataModel"
import {
  generateChatReply,
  generateEmbedding,
  generateMockEmbedding,
  getEmbeddingModel,
  MOCK_EMBEDDING_MODEL,
  resolveAiProvider,
} from "./lib/aiProviders"

type ChatSource = {
  sourceNumber: number
  chunkId: Id<"documentChunks">
  documentId: Id<"documents">
  moduleId?: Id<"modules">
  modulePath?: string[]
  headingPath?: string[]
  content: string
  score: number
  sourceKind: "direct" | "adjacent"
}

type CandidateChunk = {
  _id: Id<"documentChunks">
  documentId: Id<"documents">
  knowledgeBaseId: Id<"knowledgeBases">
  moduleId?: Id<"modules">
  content: string
  embedding: number[]
  embeddingModel?: string
  embeddingDimensions?: number
  chunkIndex?: number
  headingPath?: string[]
  modulePath?: string[]
  scopeIds?: string[]
  selectedScopeIds?: string[]
}

type RankedChunk = {
  chunk: CandidateChunk
  score: number
  vectorScore: number
  lexicalScore: number
  scopePriority: number
}

type ContextChunk = {
  chunk: CandidateChunk
  score: number
  sourceNumber: number
  sourceKind: "direct" | "adjacent"
}

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0
  let dot = 0
  let normA = 0
  let normB = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]
    normA += a[i] * a[i]
    normB += b[i] * b[i]
  }
  const denominator = Math.sqrt(normA) * Math.sqrt(normB)
  if (denominator === 0) return 0
  return dot / denominator
}

const MAX_DIRECT_MATCHES = 6
const MAX_DIRECT_MATCHES_PER_DOCUMENT = 2
const MAX_DIRECT_MATCHES_PER_MODULE = 3
const MAX_CONTEXT_CHUNKS = 12
const ADJACENT_CHUNK_WINDOW = 1
const SIMILARITY_THRESHOLD = 0.5
const MOCK_SIMILARITY_THRESHOLD = 0.2

function buildSystemPrompt(kbTitle: string): string {
  return `You are an AI tutor for the course "${kbTitle}".

Your job is to act as a teaching layer between the student and the course material.

Rules:
1. Answer only from the provided course excerpts.
2. Do not use outside knowledge.
3. Explain the answer in clear, student-friendly language.
4. When multiple sources are relevant, combine them into one coherent explanation.
5. Cite source numbers inline like [1] or [2] for factual claims, but only cite sources you actually use in the answer.
6. Refer to module/submodule names when identifying where information came from.
7. Do not mention filenames, document IDs, chunk IDs, embeddings, or retrieval internals.
8. If the excerpts do not support an answer, say: "I can only answer that if it appears in the course material. I could not find enough relevant material in this course to answer confidently."
9. Prefer a concise teaching structure: direct answer first, explanation next, and key takeaways if useful.
10. Never invent missing facts.`
}

function tokenize(text: string): string[] {
  const stopWords = new Set([
    "the",
    "and",
    "for",
    "with",
    "that",
    "this",
    "what",
    "how",
    "why",
    "when",
    "where",
    "about",
    "from",
    "into",
    "your",
    "you",
    "are",
    "can",
  ])

  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((word) => word.length > 2 && !stopWords.has(word))
}

function lexicalScore(query: string, content: string): number {
  const queryTerms = new Set(tokenize(query))
  if (queryTerms.size === 0) return 0

  const contentTerms = new Set(tokenize(content))
  let matches = 0
  for (const term of queryTerms) {
    if (contentTerms.has(term)) matches++
  }
  return matches / queryTerms.size
}

function buildMockReply(
  kbTitle: string,
  contextChunks: ContextChunk[]
): string {
  const directSource =
    contextChunks.find((source) => source.sourceKind === "direct") ??
    contextChunks[0]
  const excerpt = directSource.chunk.content
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 700)
  const source = getModuleLabel(directSource.chunk)
  return `Direct answer: Based on ${source} in "${kbTitle}", ${excerpt} [${directSource.sourceNumber}]\n\nKey takeaway: This answer is grounded in the course material from ${source}.`
}

function getScopePriority(
  chunk: CandidateChunk,
  pinnedModuleId: Id<"modules"> | undefined
): number {
  if (!pinnedModuleId) return 0
  const scopeIds: string[] = chunk.scopeIds ?? []
  const selectedScopeIds: string[] = chunk.selectedScopeIds ?? [pinnedModuleId]
  for (let i = 0; i < selectedScopeIds.length; i++) {
    if (scopeIds.includes(selectedScopeIds[i])) return i
  }
  return selectedScopeIds.length
}

function pickDirectMatches(
  scored: RankedChunk[],
  useMockAi: boolean
): RankedChunk[] {
  const threshold = useMockAi ? MOCK_SIMILARITY_THRESHOLD : SIMILARITY_THRESHOLD
  const matching = scored.filter((item) => item.score >= threshold)
  if (matching.length === 0) return []

  const sorted = matching.sort(
    (a, b) => a.scopePriority - b.scopePriority || b.score - a.score
  )
  const selected: RankedChunk[] = []
  const selectedIds = new Set<string>()
  const documentCounts = new Map<string, number>()
  const moduleCounts = new Map<string, number>()

  for (const item of sorted) {
    if (selected.length >= MAX_DIRECT_MATCHES) break

    const documentKey = item.chunk.documentId
    const moduleKey = item.chunk.moduleId ?? "course-level"
    const documentCount = documentCounts.get(documentKey) ?? 0
    const moduleCount = moduleCounts.get(moduleKey) ?? 0

    if (
      documentCount >= MAX_DIRECT_MATCHES_PER_DOCUMENT ||
      moduleCount >= MAX_DIRECT_MATCHES_PER_MODULE
    ) {
      continue
    }

    selected.push(item)
    selectedIds.add(item.chunk._id)
    documentCounts.set(documentKey, documentCount + 1)
    moduleCounts.set(moduleKey, moduleCount + 1)
  }

  for (const item of sorted) {
    if (selected.length >= MAX_DIRECT_MATCHES) break
    if (selectedIds.has(item.chunk._id)) continue
    selected.push(item)
  }

  return selected
}

function expandWithAdjacentChunks(args: {
  selected: RankedChunk[]
  allChunks: CandidateChunk[]
  window: number
  maxChunks: number
}): ContextChunk[] {
  const byDocumentAndIndex = new Map<string, CandidateChunk>()
  for (const chunk of args.allChunks) {
    if (typeof chunk.chunkIndex !== "number") continue
    byDocumentAndIndex.set(`${chunk.documentId}:${chunk.chunkIndex}`, chunk)
  }

  const contextChunks: ContextChunk[] = []
  const seenChunkIds = new Set<string>()

  function addContextChunk(
    chunk: CandidateChunk,
    ranked: RankedChunk,
    sourceNumber: number,
    sourceKind: "direct" | "adjacent"
  ) {
    if (seenChunkIds.has(chunk._id)) return
    seenChunkIds.add(chunk._id)
    contextChunks.push({
      chunk,
      score: ranked.score,
      sourceNumber,
      sourceKind,
    })
  }

  for (let i = 0; i < args.selected.length; i++) {
    if (contextChunks.length >= args.maxChunks) break

    const ranked = args.selected[i]
    const sourceNumber = i + 1
    addContextChunk(ranked.chunk, ranked, sourceNumber, "direct")

    if (typeof ranked.chunk.chunkIndex !== "number") continue

    for (let offset = -args.window; offset <= args.window; offset++) {
      if (offset === 0 || contextChunks.length >= args.maxChunks) continue

      const adjacent = byDocumentAndIndex.get(
        `${ranked.chunk.documentId}:${ranked.chunk.chunkIndex + offset}`
      )
      if (!adjacent) continue
      if (adjacent.knowledgeBaseId !== ranked.chunk.knowledgeBaseId) continue
      if (adjacent.embeddingModel !== ranked.chunk.embeddingModel) continue
      if (adjacent.embeddingDimensions !== ranked.chunk.embeddingDimensions) {
        continue
      }

      addContextChunk(adjacent, ranked, sourceNumber, "adjacent")
    }
  }

  return contextChunks
}

function getModuleLabel(chunk: CandidateChunk): string {
  return chunk.modulePath && chunk.modulePath.length > 0
    ? chunk.modulePath.join(" > ")
    : "Course-level material"
}

function buildContextMessage(contextChunks: ContextChunk[], question: string) {
  const context = contextChunks
    .map((contextChunk) => {
      const sourceLabel =
        contextChunk.sourceKind === "adjacent"
          ? `[Source ${contextChunk.sourceNumber} - adjacent context]`
          : `[Source ${contextChunk.sourceNumber}]`
      const sourceType =
        contextChunk.sourceKind === "adjacent"
          ? "surrounding context"
          : "direct match"

      return `${sourceLabel}
Module: ${getModuleLabel(contextChunk.chunk)}
Type: ${sourceType}
Excerpt:
${contextChunk.chunk.content}`
    })
    .join("\n\n")

  return `Here are the relevant course excerpts for the current question:

${context}

Now answer the following question based ONLY on the excerpts above. Cite source numbers inline and use module/submodule names when helpful. Do not use external knowledge.
Only cite a source number if that source directly supports the sentence or paragraph where the citation appears.

${question}`
}

function extractCitedSourceNumbers(reply: string): Set<number> {
  const cited = new Set<number>()
  const citationMatches = reply.matchAll(/\[([\d,\s]+)\]/g)

  for (const match of citationMatches) {
    for (const value of match[1].split(",")) {
      const sourceNumber = Number(value.trim())
      if (Number.isInteger(sourceNumber) && sourceNumber > 0) {
        cited.add(sourceNumber)
      }
    }
  }

  return cited
}

function buildSources(
  contextChunks: ContextChunk[],
  citedSourceNumbers: Set<number>
): ChatSource[] {
  const directModuleBySourceNumber = new Map<number, string>()
  for (const contextChunk of contextChunks) {
    if (contextChunk.sourceKind === "direct") {
      directModuleBySourceNumber.set(
        contextChunk.sourceNumber,
        getModuleLabel(contextChunk.chunk)
      )
    }
  }

  return contextChunks.flatMap((contextChunk) => {
    if (!citedSourceNumbers.has(contextChunk.sourceNumber)) return []

    if (
      contextChunk.sourceKind === "adjacent" &&
      directModuleBySourceNumber.get(contextChunk.sourceNumber) ===
        getModuleLabel(contextChunk.chunk)
    ) {
      return []
    }

    return {
      sourceNumber: contextChunk.sourceNumber,
      chunkId: contextChunk.chunk._id,
      documentId: contextChunk.chunk.documentId,
      moduleId: contextChunk.chunk.moduleId,
      modulePath: contextChunk.chunk.modulePath,
      headingPath: contextChunk.chunk.headingPath,
      content: contextChunk.chunk.content.slice(0, 260),
      score: contextChunk.score,
      sourceKind: contextChunk.sourceKind,
    }
  })
}

// ── Public mutations ──

export const createConversation = mutation({
  args: {
    knowledgeBaseId: v.id("knowledgeBases"),
    title: v.optional(v.string()),
    pinnedModuleId: v.optional(v.id("modules")),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity()
    if (!identity) throw new Error("Not authenticated")

    const profile = await ctx.db
      .query("profiles")
      .withIndex("by_tokenIdentifier", (q) =>
        q.eq("tokenIdentifier", identity.tokenIdentifier)
      )
      .unique()

    if (!profile) throw new Error("Profile not found")

    const kb = await ctx.db.get("knowledgeBases", args.knowledgeBaseId)
    if (!kb) throw new Error("Knowledge base not found")

    const id = await ctx.db.insert("conversations", {
      knowledgeBaseId: args.knowledgeBaseId,
      userId: profile._id,
      title: args.title ?? `Chat with ${kb.title}`,
      isActive: true,
      pinnedModuleId: args.pinnedModuleId,
    })

    return await ctx.db.get("conversations", id)
  },
})

export const listConversations = query({
  args: { knowledgeBaseId: v.id("knowledgeBases") },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity()
    if (!identity) return []

    const profile = await ctx.db
      .query("profiles")
      .withIndex("by_tokenIdentifier", (q) =>
        q.eq("tokenIdentifier", identity.tokenIdentifier)
      )
      .unique()

    if (!profile) return []

    const conversations = await ctx.db
      .query("conversations")
      .withIndex("by_userId_and_knowledgeBaseId", (q) =>
        q.eq("userId", profile._id).eq("knowledgeBaseId", args.knowledgeBaseId)
      )
      .order("desc")
      .take(50)

    const modules = await ctx.db
      .query("modules")
      .withIndex("by_knowledgeBaseId", (q) =>
        q.eq("knowledgeBaseId", args.knowledgeBaseId)
      )
      .collect()

    const moduleById = new Map(modules.map((mod) => [mod._id, mod]))

    function getModulePath(moduleId: Id<"modules"> | undefined): string[] {
      if (!moduleId) return []
      const path: string[] = []
      let current = moduleById.get(moduleId)
      while (current) {
        path.unshift(current.name)
        current = current.parentId
          ? moduleById.get(current.parentId)
          : undefined
      }
      return path
    }

    return conversations.map((conversation) => ({
      ...conversation,
      modulePath: getModulePath(conversation.pinnedModuleId),
    }))
  },
})

export const archiveConversation = mutation({
  args: {
    id: v.id("conversations"),
    isActive: v.boolean(),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity()
    if (!identity) throw new Error("Not authenticated")

    const profile = await ctx.db
      .query("profiles")
      .withIndex("by_tokenIdentifier", (q) =>
        q.eq("tokenIdentifier", identity.tokenIdentifier)
      )
      .unique()
    if (!profile) throw new Error("Profile not found")

    const conversation = await ctx.db.get(args.id)
    if (!conversation || conversation.userId !== profile._id) {
      throw new Error("Not authorized")
    }

    await ctx.db.patch(args.id, { isActive: args.isActive })
    return await ctx.db.get(args.id)
  },
})

export const deleteConversation = mutation({
  args: { id: v.id("conversations") },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity()
    if (!identity) throw new Error("Not authenticated")

    const profile = await ctx.db
      .query("profiles")
      .withIndex("by_tokenIdentifier", (q) =>
        q.eq("tokenIdentifier", identity.tokenIdentifier)
      )
      .unique()
    if (!profile) throw new Error("Profile not found")

    const conversation = await ctx.db.get(args.id)
    if (!conversation || conversation.userId !== profile._id) {
      throw new Error("Not authorized")
    }

    const messages = await ctx.db
      .query("messages")
      .withIndex("by_conversationId", (q) => q.eq("conversationId", args.id))
      .collect()

    for (const message of messages) {
      await ctx.db.delete(message._id)
    }

    await ctx.db.delete(args.id)
  },
})

export const getConversation = query({
  args: { id: v.id("conversations") },
  handler: async (ctx, args) => {
    return await ctx.db.get("conversations", args.id)
  },
})

export const getMessages = query({
  args: { conversationId: v.id("conversations") },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity()
    if (!identity) return []

    const profile = await ctx.db
      .query("profiles")
      .withIndex("by_tokenIdentifier", (q) =>
        q.eq("tokenIdentifier", identity.tokenIdentifier)
      )
      .unique()
    if (!profile) return []

    const conversation = await ctx.db.get(args.conversationId)
    if (!conversation || conversation.userId !== profile._id) return []

    return await ctx.db
      .query("messages")
      .withIndex("by_conversationId", (q) =>
        q.eq("conversationId", args.conversationId)
      )
      .order("asc")
      .take(100)
  },
})

// ── Public action (external AI calls belong in actions, not mutations) ──

export const sendMessage = action({
  args: {
    conversationId: v.id("conversations"),
    content: v.string(),
  },
  handler: async (
    ctx,
    args
  ): Promise<{
    content: string
    sources: ChatSource[]
  }> => {
    const identity = await ctx.auth.getUserIdentity()
    if (!identity) throw new Error("Not authenticated")

    const profile = await ctx.runQuery(internal.chatInternal.getProfile, {
      tokenIdentifier: identity.tokenIdentifier,
    })
    if (!profile) throw new Error("Profile not found")

    const conversation: any = await ctx.runQuery(
      internal.chatInternal.getConversation,
      {
        id: args.conversationId,
      }
    )
    if (!conversation) throw new Error("Conversation not found")
    if (conversation.userId !== profile._id) throw new Error("Not authorized")

    const kb: any = await ctx.runQuery(internal.chatInternal.getKB, {
      id: conversation.knowledgeBaseId,
    })
    if (!kb) throw new Error("Knowledge base not found")

    await ctx.runMutation(internal.chatInternal.insertMessage, {
      conversationId: args.conversationId,
      role: "user",
      content: args.content,
    })

    const openAiApiKey = process.env.OPENAI_API_KEY
    const geminiApiKey = process.env.GEMINI_API_KEY
    let provider = resolveAiProvider({
      requestedProvider: process.env.AI_PROVIDER,
      mockAi: process.env.MOCK_AI,
      openAiApiKey,
      geminiApiKey,
    })
    let useMockAi = provider === "mock"

    let queryEmbedding: number[]
    let queryEmbeddingModel = getEmbeddingModel(provider)
    if (useMockAi) {
      queryEmbedding = generateMockEmbedding(args.content)
    } else {
      try {
        const generated = await generateEmbedding({
          text: args.content,
          provider,
          task: "query",
          openAiApiKey,
          geminiApiKey,
        })
        queryEmbedding = generated.embedding
        queryEmbeddingModel = generated.embeddingModel
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Unknown embedding error"
        console.warn(
          `${provider} embedding failed, using mock chat: ${message}`
        )
        provider = "mock"
        useMockAi = true
        queryEmbeddingModel = MOCK_EMBEDDING_MODEL
        queryEmbedding = generateMockEmbedding(args.content)
      }
    }

    const allCandidateChunks: CandidateChunk[] = await ctx.runQuery(
      internal.chatInternal.getCandidateChunks,
      {
        knowledgeBaseId: conversation.knowledgeBaseId,
        pinnedModuleId: conversation.pinnedModuleId,
      }
    )

    if (allCandidateChunks.length === 0) {
      const notReady =
        "The course material is not ready yet. Please ask again after the uploaded documents finish processing."

      await ctx.runMutation(internal.chatInternal.insertMessage, {
        conversationId: args.conversationId,
        role: "assistant",
        content: notReady,
      })

      return { content: notReady, sources: [] }
    }

    const compatibleChunks = allCandidateChunks.filter(
      (chunk) =>
        chunk.embeddingModel === queryEmbeddingModel &&
        chunk.embeddingDimensions === queryEmbedding.length
    )

    const scored: RankedChunk[] = compatibleChunks.map((chunk) => {
      const vectorScore = cosineSimilarity(queryEmbedding, chunk.embedding)
      const textScore = lexicalScore(args.content, chunk.content)
      return {
        chunk,
        score: useMockAi ? textScore : 0.8 * vectorScore + 0.2 * textScore,
        vectorScore,
        lexicalScore: textScore,
        scopePriority: getScopePriority(chunk, conversation.pinnedModuleId),
      }
    })

    const directMatches = pickDirectMatches(scored, useMockAi)

    if (directMatches.length === 0) {
      const refusal: string =
        compatibleChunks.length === 0
          ? `I can't access compatible course material for "${kb.title}" yet. Please reprocess the uploaded documents for the selected AI provider, then ask again.`
          : "I can only answer that if it appears in the course material. I could not find enough relevant material in this course to answer confidently."

      await ctx.runMutation(internal.chatInternal.insertMessage, {
        conversationId: args.conversationId,
        role: "assistant",
        content: refusal,
      })

      return { content: refusal, sources: [] }
    }

    const contextChunks = expandWithAdjacentChunks({
      selected: directMatches,
      allChunks: compatibleChunks,
      window: ADJACENT_CHUNK_WINDOW,
      maxChunks: MAX_CONTEXT_CHUNKS,
    })

    const systemPrompt = buildSystemPrompt(kb.title)

    const previousMessages = await ctx.runQuery(
      internal.chatInternal.getPreviousMessages,
      {
        conversationId: args.conversationId,
      }
    )

    const chatMessages = [
      { role: "system" as const, content: systemPrompt },
      ...previousMessages.map((m: any) => ({
        role: m.role as "user" | "assistant",
        content: m.content,
      })),
    ]

    const contextMessage = {
      role: "user" as const,
      content: buildContextMessage(contextChunks, args.content),
    }

    let reply: string
    if (useMockAi) {
      reply = buildMockReply(kb.title, contextChunks)
    } else {
      try {
        reply = await generateChatReply({
          provider,
          messages: [...chatMessages.slice(0, -1), contextMessage],
          openAiApiKey,
          geminiApiKey,
        })
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Unknown chat error"
        console.warn(`${provider} chat failed, using mock reply: ${message}`)
        reply = buildMockReply(kb.title, contextChunks)
      }
    }

    const citedSourceNumbers = extractCitedSourceNumbers(reply)
    const sources = buildSources(contextChunks, citedSourceNumbers)

    await ctx.runMutation(internal.chatInternal.insertMessage, {
      conversationId: args.conversationId,
      role: "assistant",
      content: reply,
      sourceChunks: sources,
    })

    return { content: reply, sources }
  },
})

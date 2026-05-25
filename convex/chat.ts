/* eslint-disable @typescript-eslint/no-explicit-any */

import { v } from "convex/values"
import { action, mutation, query } from "./_generated/server"
import { internal } from "./_generated/api"
import type { Id } from "./_generated/dataModel"

type ChatSource = {
  chunkId: Id<"documentChunks">
  documentId: Id<"documents">
  moduleId?: Id<"modules">
  modulePath?: string[]
  documentFilename?: string
  content: string
  score: number
}

type RankedChunk = {
  chunk: any
  score: number
  vectorScore: number
  lexicalScore: number
  scopePriority: number
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

const SIMILARITY_THRESHOLD = 0.5
const MAX_CONTEXT_CHUNKS = 5
const MOCK_EMBEDDING_DIMENSIONS = 64
const MOCK_EMBEDDING_MODEL = "mock-hash-64"
const OPENAI_EMBEDDING_MODEL = "text-embedding-3-small"

function buildSystemPrompt(kbTitle: string): string {
  return `You are an AI tutor for the course "${kbTitle}". Your role is to help students understand the course material.

RULES:
1. ONLY answer questions using the provided context from the course materials below.
2. If the question CAN be answered from the context, answer clearly and cite the relevant parts.
3. If the question CANNOT be answered from the provided context, respond with: "I can only answer questions about "${kbTitle}". Please ask a question related to this course material."
4. Do NOT make up information, speculate, or use any external knowledge.
5. Do NOT answer questions about unrelated topics, even if you know the answer.
6. Keep responses focused on the course material. Be concise and educational.
7. Mention the module/submodule path from the provided source labels when answering.`
}

function generateMockEmbedding(text: string): number[] {
  const embedding = Array.from({ length: MOCK_EMBEDDING_DIMENSIONS }, () => 0)
  for (const word of tokenize(text)) {
    let hash = 0
    for (let i = 0; i < word.length; i++) {
      hash = (hash * 31 + word.charCodeAt(i)) | 0
    }
    embedding[Math.abs(hash) % MOCK_EMBEDDING_DIMENSIONS] += 1
  }
  const norm = Math.hypot(...embedding) || 1
  return embedding.map((value) => value / norm)
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

function buildMockReply(kbTitle: string, chunk: any): string {
  const excerpt = chunk.content.replace(/\s+/g, " ").trim().slice(0, 700)
  const source =
    chunk.modulePath?.length > 0
      ? chunk.modulePath.join(" > ")
      : "course-level material"
  return `Based on ${source} in "${kbTitle}": ${excerpt}`
}

function getScopePriority(chunk: any, pinnedModuleId: string | undefined): number {
  if (!pinnedModuleId) return 0
  const scopeIds: string[] = chunk.scopeIds ?? []
  const selectedScopeIds: string[] = chunk.selectedScopeIds ?? [pinnedModuleId]
  for (let i = 0; i < selectedScopeIds.length; i++) {
    if (scopeIds.includes(selectedScopeIds[i])) return i
  }
  return selectedScopeIds.length
}

function pickRelevant(scored: RankedChunk[], useMockAi: boolean): RankedChunk[] {
  const threshold = useMockAi ? 0.2 : SIMILARITY_THRESHOLD
  const matching = scored.filter((item) => item.score >= threshold)
  if (matching.length === 0) return []

  const bestPriority = Math.min(...matching.map((item) => item.scopePriority))
  return matching
    .filter((item) => item.scopePriority === bestPriority)
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_CONTEXT_CHUNKS)
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
        q.eq("tokenIdentifier", identity.tokenIdentifier),
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
        q.eq("tokenIdentifier", identity.tokenIdentifier),
      )
      .unique()

    if (!profile) return []

    const conversations = await ctx.db
      .query("conversations")
      .withIndex("by_userId_and_knowledgeBaseId", (q) =>
        q.eq("userId", profile._id).eq("knowledgeBaseId", args.knowledgeBaseId),
      )
      .order("desc")
      .take(50)

    const modules = await ctx.db
      .query("modules")
      .withIndex("by_knowledgeBaseId", (q) =>
        q.eq("knowledgeBaseId", args.knowledgeBaseId),
      )
      .collect()

    const moduleById = new Map(modules.map((mod) => [mod._id, mod]))

    function getModulePath(moduleId: Id<"modules"> | undefined): string[] {
      if (!moduleId) return []
      const path: string[] = []
      let current = moduleById.get(moduleId)
      while (current) {
        path.unshift(current.name)
        current = current.parentId ? moduleById.get(current.parentId) : undefined
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
        q.eq("tokenIdentifier", identity.tokenIdentifier),
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
        q.eq("tokenIdentifier", identity.tokenIdentifier),
      )
      .unique()
    if (!profile) throw new Error("Profile not found")

    const conversation = await ctx.db.get(args.id)
    if (!conversation || conversation.userId !== profile._id) {
      throw new Error("Not authorized")
    }

    const messages = await ctx.db
      .query("messages")
      .withIndex("by_conversationId", (q) =>
        q.eq("conversationId", args.id),
      )
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
        q.eq("tokenIdentifier", identity.tokenIdentifier),
      )
      .unique()
    if (!profile) return []

    const conversation = await ctx.db.get(args.conversationId)
    if (!conversation || conversation.userId !== profile._id) return []

    return await ctx.db
      .query("messages")
      .withIndex("by_conversationId", (q) =>
        q.eq("conversationId", args.conversationId),
      )
      .order("asc")
      .take(100)
  },
})

// ── Public action (OpenAI calls belong in actions, not mutations) ──

export const sendMessage = action({
  args: {
    conversationId: v.id("conversations"),
    content: v.string(),
  },
  handler: async (
    ctx,
    args,
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

    const conversation: any = await ctx.runQuery(internal.chatInternal.getConversation, {
      id: args.conversationId,
    })
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

    const apiKey = process.env.OPENAI_API_KEY
    let useMockAi = !apiKey || process.env.MOCK_AI !== "false"

    let queryEmbedding: number[]
    let queryEmbeddingModel = useMockAi
      ? MOCK_EMBEDDING_MODEL
      : OPENAI_EMBEDDING_MODEL
    if (useMockAi) {
      queryEmbedding = generateMockEmbedding(args.content)
    } else {
      const embedRes = await fetch("https://api.openai.com/v1/embeddings", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: "text-embedding-3-small",
          input: args.content,
        }),
      })

      if (!embedRes.ok) {
        const err = await embedRes.text()
        console.warn(`OpenAI embedding failed, using mock chat: ${err}`)
        useMockAi = true
        queryEmbeddingModel = MOCK_EMBEDDING_MODEL
        queryEmbedding = generateMockEmbedding(args.content)
      } else {
        const embedData = await embedRes.json()
        queryEmbedding = embedData.data[0].embedding
      }
    }

    const allKbChunks: any[] = await ctx.runQuery(internal.chatInternal.getChunks, {
      knowledgeBaseId: conversation.knowledgeBaseId,
      pinnedModuleId: conversation.pinnedModuleId,
    })

    const compatibleChunks = allKbChunks.filter(
      (chunk: any) =>
        chunk.embeddingModel === queryEmbeddingModel &&
        chunk.embeddingDimensions === queryEmbedding.length,
    )

    const scored: RankedChunk[] = compatibleChunks.map((chunk: any) => {
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

    const relevant = pickRelevant(scored, useMockAi)

    if (relevant.length === 0) {
      const refusal: string =
        allKbChunks.length > 0 && compatibleChunks.length === 0
          ? `I can't access compatible course material for "${kb.title}" yet. Please ask again after the documents are reprocessed.`
          : `I can only answer questions about "${kb.title}". Please ask a question related to this course material.`

      await ctx.runMutation(internal.chatInternal.insertMessage, {
        conversationId: args.conversationId,
        role: "assistant",
        content: refusal,
      })

      return { content: refusal, sources: [] }
    }

    const context = relevant
      .map((r: any, i: number) => `[Source ${i + 1}]: ${r.chunk.content}`)
      .join("\n\n")
    const contextWithModules = relevant
      .map((r: RankedChunk, i: number) => {
        const modulePath =
          r.chunk.modulePath?.length > 0
            ? r.chunk.modulePath.join(" > ")
            : "Course-level material"
        const filename = r.chunk.documentFilename
          ? `; File: ${r.chunk.documentFilename}`
          : ""
        return `[Source ${i + 1}; Module: ${modulePath}${filename}]: ${r.chunk.content}`
      })
      .join("\n\n")

    const systemPrompt = buildSystemPrompt(kb.title)

    const previousMessages = await ctx.runQuery(
      internal.chatInternal.getPreviousMessages,
      {
      conversationId: args.conversationId,
      },
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
      content: `Here is the relevant course material for the current question:\n\n${contextWithModules || context}\n\nNow answer the following question based ONLY on the material above. Mention which module/submodule the information came from. Do not use any external knowledge:\n\n${args.content}`,
    }

    let reply: string
    if (useMockAi) {
      reply = buildMockReply(kb.title, relevant[0].chunk)
    } else {
      const chatRes = await fetch(
        "https://api.openai.com/v1/chat/completions",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            model: "gpt-4o-mini",
            messages: [...chatMessages.slice(0, -1), contextMessage],
            temperature: 0.3,
            max_tokens: 1024,
          }),
        },
      )

      if (!chatRes.ok) {
        const err = await chatRes.text()
        console.warn(`OpenAI chat failed, using mock reply: ${err}`)
        reply = buildMockReply(kb.title, relevant[0].chunk)
      } else {
        const chatData = await chatRes.json()
        reply = chatData.choices[0].message.content
      }
    }

    const sources: ChatSource[] = relevant.map((r: any) => ({
      chunkId: r.chunk._id,
      documentId: r.chunk.documentId,
      moduleId: r.chunk.moduleId,
      modulePath: r.chunk.modulePath,
      documentFilename: r.chunk.documentFilename,
      content: r.chunk.content.slice(0, 200),
      score: r.score,
    }))

    await ctx.runMutation(internal.chatInternal.insertMessage, {
      conversationId: args.conversationId,
      role: "assistant",
      content: reply,
      sourceChunks: sources,
    })

    return { content: reply, sources }
  },
})

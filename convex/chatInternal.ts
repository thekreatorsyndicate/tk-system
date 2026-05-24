import { v } from "convex/values"
import { internalMutation, internalQuery } from "./_generated/server"
import type { Id } from "./_generated/dataModel"

export const getProfile = internalQuery({
  args: { tokenIdentifier: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("profiles")
      .withIndex("by_tokenIdentifier", (q) =>
        q.eq("tokenIdentifier", args.tokenIdentifier),
      )
      .unique()
  },
})

export const getConversation = internalQuery({
  args: { id: v.id("conversations") },
  handler: async (ctx, args) => {
    return await ctx.db.get("conversations", args.id)
  },
})

export const getKB = internalQuery({
  args: { id: v.id("knowledgeBases") },
  handler: async (ctx, args) => {
    return await ctx.db.get("knowledgeBases", args.id)
  },
})

export const getChunks = internalQuery({
  args: {
    knowledgeBaseId: v.id("knowledgeBases"),
    pinnedModuleId: v.optional(v.id("modules")),
  },
  handler: async (ctx, args) => {
    const chunks = await ctx.db
      .query("documentChunks")
      .withIndex("by_knowledgeBaseId", (q) =>
        q.eq("knowledgeBaseId", args.knowledgeBaseId),
      )
      .collect()

    const modules = await ctx.db
      .query("modules")
      .withIndex("by_knowledgeBaseId", (q) =>
        q.eq("knowledgeBaseId", args.knowledgeBaseId),
      )
      .collect()

    const documents = await ctx.db
      .query("documents")
      .withIndex("by_knowledgeBaseId", (q) =>
        q.eq("knowledgeBaseId", args.knowledgeBaseId),
      )
      .collect()

    const moduleById = new Map(modules.map((mod) => [mod._id, mod]))
    const documentById = new Map(documents.map((doc) => [doc._id, doc]))

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

    function getScopeIds(moduleId: Id<"modules"> | undefined): string[] {
      if (!moduleId) return []
      const ids: string[] = []
      let current = moduleById.get(moduleId)
      while (current) {
        ids.push(current._id)
        current = current.parentId ? moduleById.get(current.parentId) : undefined
      }
      return ids
    }

    const selectedScopeIds = getScopeIds(args.pinnedModuleId)

    return chunks.map((chunk) => {
      const document = documentById.get(chunk.documentId)
      return {
        ...chunk,
        documentFilename: document?.filename,
        modulePath: getModulePath(chunk.moduleId),
        scopeIds: getScopeIds(chunk.moduleId),
        selectedScopeIds,
      }
    })
  },
})

export const getPreviousMessages = internalQuery({
  args: { conversationId: v.id("conversations") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("messages")
      .withIndex("by_conversationId", (q) =>
        q.eq("conversationId", args.conversationId),
      )
      .order("asc")
      .take(100)
  },
})

export const insertMessage = internalMutation({
  args: {
    conversationId: v.id("conversations"),
    role: v.union(v.literal("user"), v.literal("assistant")),
    content: v.string(),
    sourceChunks: v.optional(
      v.array(
        v.object({
          chunkId: v.id("documentChunks"),
          documentId: v.id("documents"),
          moduleId: v.optional(v.id("modules")),
          modulePath: v.optional(v.array(v.string())),
          documentFilename: v.optional(v.string()),
          content: v.string(),
          score: v.number(),
        }),
      ),
    ),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("messages", {
      conversationId: args.conversationId,
      role: args.role,
      content: args.content,
      sourceChunks: args.sourceChunks,
    })
  },
})

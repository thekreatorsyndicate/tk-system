import { v } from "convex/values"
import { internalMutation, internalQuery } from "./_generated/server"
import type { Doc, Id } from "./_generated/dataModel"

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
    const modules = await ctx.db
      .query("modules")
      .withIndex("by_knowledgeBaseId", (q) =>
        q.eq("knowledgeBaseId", args.knowledgeBaseId),
      )
      .take(5000)

    const documents = await ctx.db
      .query("documents")
      .withIndex("by_knowledgeBaseId", (q) =>
        q.eq("knowledgeBaseId", args.knowledgeBaseId),
      )
      .take(5000)

    const moduleById = new Map(modules.map((mod) => [mod._id, mod]))
    const readyDocuments = documents.filter((document) => document.status === "ready")
    const documentById = new Map(readyDocuments.map((doc) => [doc._id, doc]))

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

    function getDescendantModuleIds(moduleId: Id<"modules">): Id<"modules">[] {
      const descendants = [moduleId]
      for (const courseModule of modules) {
        let current = courseModule.parentId
          ? moduleById.get(courseModule.parentId)
          : undefined
        while (current) {
          if (current._id === moduleId) {
            descendants.push(courseModule._id)
            break
          }
          current = current.parentId ? moduleById.get(current.parentId) : undefined
        }
      }
      return descendants
    }

    const selectedScopeIds = getScopeIds(args.pinnedModuleId)
    let chunks: Doc<"documentChunks">[] = []

    if (args.pinnedModuleId) {
      const moduleIds = getDescendantModuleIds(args.pinnedModuleId)
      const scopedChunks = await Promise.all(
        moduleIds.map((moduleId) =>
          ctx.db
            .query("documentChunks")
            .withIndex("by_knowledgeBaseId_and_moduleId", (q) =>
              q.eq("knowledgeBaseId", args.knowledgeBaseId).eq("moduleId", moduleId),
            )
            .take(1000),
        ),
      )
      chunks = scopedChunks.flat()
    }

    if (chunks.length === 0) {
      chunks = await ctx.db
        .query("documentChunks")
        .withIndex("by_knowledgeBaseId", (q) =>
          q.eq("knowledgeBaseId", args.knowledgeBaseId),
        )
        .take(5000)
    }

    return chunks.flatMap((chunk) => {
      const document = documentById.get(chunk.documentId)
      if (!document) return []

      return {
        ...chunk,
        documentFilename: document?.filename,
        documentEmbeddingModel: document.embeddingModel,
        documentEmbeddingDimensions: document.embeddingDimensions,
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

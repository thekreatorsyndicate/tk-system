import { v } from "convex/values"
import { internalMutation, internalQuery } from "./_generated/server"
import type { Doc, Id } from "./_generated/dataModel"
import type { QueryCtx } from "./_generated/server"

export const getProfile = internalQuery({
  args: { tokenIdentifier: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("profiles")
      .withIndex("by_tokenIdentifier", (q) =>
        q.eq("tokenIdentifier", args.tokenIdentifier)
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

async function getModuleContext(
  ctx: QueryCtx,
  knowledgeBaseId: Id<"knowledgeBases">,
  pinnedModuleId: Id<"modules"> | undefined
) {
  const modules = await ctx.db
    .query("modules")
    .withIndex("by_knowledgeBaseId", (q) =>
      q.eq("knowledgeBaseId", knowledgeBaseId)
    )
    .take(5000)
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
        current = current.parentId
          ? moduleById.get(current.parentId)
          : undefined
      }
    }
    return descendants
  }

  return {
    getModulePath,
    getScopeIds,
    selectedScopeIds: getScopeIds(pinnedModuleId),
    descendantModuleIds: pinnedModuleId
      ? new Set(getDescendantModuleIds(pinnedModuleId))
      : undefined,
  }
}

async function attachChunkContext(
  ctx: QueryCtx,
  chunks: Doc<"documentChunks">[],
  knowledgeBaseId: Id<"knowledgeBases">,
  pinnedModuleId: Id<"modules"> | undefined
) {
  const documents = new Map()
  for (const chunk of chunks) {
    if (documents.has(chunk.documentId)) continue
    const document = await ctx.db.get(chunk.documentId)
    if (document) documents.set(chunk.documentId, document)
  }

  const moduleContext = await getModuleContext(ctx, knowledgeBaseId, pinnedModuleId)

  return chunks.flatMap((chunk) => {
    const document = documents.get(chunk.documentId)
    if (!document || document.status !== "ready") return []
    if (document.knowledgeBaseId !== knowledgeBaseId) return []

    const modulePath =
      chunk.modulePath && chunk.modulePath.length > 0
        ? chunk.modulePath
        : moduleContext.getModulePath(chunk.moduleId)
    const scopeIds =
      chunk.scopeIds && chunk.scopeIds.length > 0
        ? chunk.scopeIds
        : moduleContext.getScopeIds(chunk.moduleId)

    return {
      ...chunk,
      documentTitle: chunk.documentTitle ?? document.filename,
      documentEmbeddingModel: document.embeddingModel,
      documentEmbeddingDimensions: document.embeddingDimensions,
      modulePath,
      scopeIds,
      selectedScopeIds: moduleContext.selectedScopeIds,
      isInPinnedScope:
        !moduleContext.descendantModuleIds ||
        (chunk.moduleId !== undefined &&
          moduleContext.descendantModuleIds.has(chunk.moduleId)),
    }
  })
}

export const getCandidateChunks = internalQuery({
  args: {
    knowledgeBaseId: v.id("knowledgeBases"),
    pinnedModuleId: v.optional(v.id("modules")),
  },
  handler: async (ctx, args) => {
    const documents = await ctx.db
      .query("documents")
      .withIndex("by_knowledgeBaseId", (q) =>
        q.eq("knowledgeBaseId", args.knowledgeBaseId)
      )
      .take(5000)

    const readyDocuments = documents.filter(
      (document) => document.status === "ready"
    )
    const documentById = new Map(readyDocuments.map((doc) => [doc._id, doc]))
    const moduleContext = await getModuleContext(
      ctx,
      args.knowledgeBaseId,
      args.pinnedModuleId
    )

    const chunks: Doc<"documentChunks">[] = await ctx.db
      .query("documentChunks")
      .withIndex("by_knowledgeBaseId", (q) =>
        q.eq("knowledgeBaseId", args.knowledgeBaseId)
      )
      .take(5000)

    return chunks.flatMap((chunk) => {
      const document = documentById.get(chunk.documentId)
      if (!document) return []

      const modulePath =
        chunk.modulePath && chunk.modulePath.length > 0
          ? chunk.modulePath
          : moduleContext.getModulePath(chunk.moduleId)
      const scopeIds =
        chunk.scopeIds && chunk.scopeIds.length > 0
          ? chunk.scopeIds
          : moduleContext.getScopeIds(chunk.moduleId)

      return {
        ...chunk,
        documentTitle: chunk.documentTitle ?? document.filename,
        documentEmbeddingModel: document.embeddingModel,
        documentEmbeddingDimensions: document.embeddingDimensions,
        modulePath,
        scopeIds,
        selectedScopeIds: moduleContext.selectedScopeIds,
        isInPinnedScope:
          !moduleContext.descendantModuleIds ||
          (chunk.moduleId !== undefined &&
            moduleContext.descendantModuleIds.has(chunk.moduleId)),
      }
    })
  },
})

export const getReadyChunkContextByIds = internalQuery({
  args: {
    knowledgeBaseId: v.id("knowledgeBases"),
    pinnedModuleId: v.optional(v.id("modules")),
    ids: v.array(v.id("documentChunks")),
  },
  handler: async (ctx, args) => {
    const chunks = []
    const seenIds = new Set<string>()
    for (const id of args.ids) {
      if (seenIds.has(id)) continue
      seenIds.add(id)
      const chunk = await ctx.db.get(id)
      if (chunk) chunks.push(chunk)
    }

    return await attachChunkContext(
      ctx,
      chunks,
      args.knowledgeBaseId,
      args.pinnedModuleId
    )
  },
})

export const getAdjacentChunksForMatches = internalQuery({
  args: {
    knowledgeBaseId: v.id("knowledgeBases"),
    pinnedModuleId: v.optional(v.id("modules")),
    queryEmbeddingModel: v.string(),
    queryEmbeddingDimensions: v.number(),
    matches: v.array(
      v.object({
        documentId: v.id("documents"),
        chunkIndex: v.number(),
      })
    ),
  },
  handler: async (ctx, args) => {
    const chunksById = new Map<string, Doc<"documentChunks">>()

    for (const match of args.matches) {
      for (let offset = -1; offset <= 1; offset++) {
        const chunk = await ctx.db
          .query("documentChunks")
          .withIndex("by_documentId_and_chunkIndex", (q) =>
            q
              .eq("documentId", match.documentId)
              .eq("chunkIndex", match.chunkIndex + offset)
          )
          .unique()

        if (!chunk) continue
        if (chunk.knowledgeBaseId !== args.knowledgeBaseId) continue
        if (chunk.embeddingModel !== args.queryEmbeddingModel) continue
        if (chunk.embeddingDimensions !== args.queryEmbeddingDimensions) {
          continue
        }
        chunksById.set(chunk._id, chunk)
      }
    }

    return await attachChunkContext(
      ctx,
      Array.from(chunksById.values()),
      args.knowledgeBaseId,
      args.pinnedModuleId
    )
  },
})

export const searchChunksByText = internalQuery({
  args: {
    knowledgeBaseId: v.id("knowledgeBases"),
    query: v.string(),
    limit: v.number(),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("documentChunks")
      .withSearchIndex("by_searchText", (q) =>
        q
          .search("searchText", args.query)
          .eq("knowledgeBaseId", args.knowledgeBaseId)
      )
      .take(args.limit)
  },
})

export const getChunksByIds = internalQuery({
  args: { ids: v.array(v.id("documentChunks")) },
  handler: async (ctx, args) => {
    const chunks = []
    for (const id of args.ids) {
      const chunk = await ctx.db.get(id)
      if (chunk) chunks.push(chunk)
    }
    return chunks
  },
})

export const getPreviousMessages = internalQuery({
  args: { conversationId: v.id("conversations") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("messages")
      .withIndex("by_conversationId", (q) =>
        q.eq("conversationId", args.conversationId)
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
          sourceNumber: v.optional(v.number()),
          chunkId: v.id("documentChunks"),
          documentId: v.id("documents"),
          moduleId: v.optional(v.id("modules")),
          modulePath: v.optional(v.array(v.string())),
          headingPath: v.optional(v.array(v.string())),
          documentFilename: v.optional(v.string()),
          content: v.string(),
          score: v.number(),
          sourceKind: v.optional(
            v.union(v.literal("direct"), v.literal("adjacent"))
          ),
        })
      )
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

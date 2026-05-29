import { v } from "convex/values"
import { internalMutation, internalQuery } from "./_generated/server"
import { OPENAI_EMBEDDING_MODEL } from "./lib/aiProviders"
import { normalizeSearchText, SEARCH_VERSION } from "./lib/retrieval"
import type { Id } from "./_generated/dataModel"

export const updateStatus = internalMutation({
  args: {
    documentId: v.id("documents"),
    status: v.union(
      v.literal("uploading"),
      v.literal("processing"),
      v.literal("ready"),
      v.literal("error"),
    ),
    errorMessage: v.optional(v.string()),
    clearErrorMessage: v.optional(v.boolean()),
    parserVersion: v.optional(v.string()),
    embeddingModel: v.optional(v.string()),
    embeddingDimensions: v.optional(v.number()),
    chunkCount: v.optional(v.number()),
    processedAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const patch: {
      status: "uploading" | "processing" | "ready" | "error"
      errorMessage?: string
      clearErrorMessage?: never
      parserVersion?: string
      embeddingModel?: string
      embeddingDimensions?: number
      chunkCount?: number
      processedAt?: number
    } = {
      status: args.status,
    }
    if (args.errorMessage !== undefined) {
      patch.errorMessage = args.errorMessage
    }
    if (args.clearErrorMessage) {
      patch.errorMessage = undefined
    }
    if (args.parserVersion !== undefined) {
      patch.parserVersion = args.parserVersion
    }
    if (args.embeddingModel !== undefined) {
      patch.embeddingModel = args.embeddingModel
    }
    if (args.embeddingDimensions !== undefined) {
      patch.embeddingDimensions = args.embeddingDimensions
    }
    if (args.chunkCount !== undefined) {
      patch.chunkCount = args.chunkCount
    }
    if (args.processedAt !== undefined) {
      patch.processedAt = args.processedAt
    }
    await ctx.db.patch("documents", args.documentId, patch)
  },
})

export const cleanupChunks = internalMutation({
  args: { documentId: v.id("documents") },
  handler: async (ctx, args) => {
    const chunks = await ctx.db
      .query("documentChunks")
      .withIndex("by_documentId", (q) => q.eq("documentId", args.documentId))
      .take(100)

    for (const chunk of chunks) {
      await ctx.db.delete(chunk._id)
    }

    return chunks.length === 100
  },
})

export const getModuleMetadata = internalQuery({
  args: {
    knowledgeBaseId: v.id("knowledgeBases"),
    moduleId: v.optional(v.id("modules")),
  },
  handler: async (ctx, args) => {
    const modules = await ctx.db
      .query("modules")
      .withIndex("by_knowledgeBaseId", (q) =>
        q.eq("knowledgeBaseId", args.knowledgeBaseId)
      )
      .take(5000)
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

    function getScopeIds(moduleId: Id<"modules"> | undefined): string[] {
      if (!moduleId) return []
      const ids: string[] = []
      let current = moduleById.get(moduleId)
      while (current) {
        ids.push(current._id)
        current = current.parentId
          ? moduleById.get(current.parentId)
          : undefined
      }
      return ids
    }

    const modulePath = getModulePath(args.moduleId)
    return {
      modulePath,
      modulePathText: modulePath.join(" "),
      scopeIds: getScopeIds(args.moduleId),
    }
  },
})

export const storeChunk = internalMutation({
  args: {
    documentId: v.id("documents"),
    knowledgeBaseId: v.id("knowledgeBases"),
    moduleId: v.optional(v.id("modules")),
    content: v.string(),
    embedding: v.array(v.number()),
    tokenCount: v.number(),
    chunkIndex: v.number(),
    sourceStart: v.number(),
    sourceEnd: v.number(),
    parserVersion: v.string(),
    embeddingModel: v.string(),
    embeddingDimensions: v.number(),
    searchText: v.string(),
    searchVersion: v.string(),
    embeddingOpenAi1536: v.optional(v.array(v.float64())),
    modulePath: v.optional(v.array(v.string())),
    modulePathText: v.optional(v.string()),
    scopeIds: v.optional(v.array(v.string())),
    documentTitle: v.string(),
    headingPath: v.optional(v.array(v.string())),
    pageStart: v.optional(v.number()),
    pageEnd: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("documentChunks", {
      documentId: args.documentId,
      knowledgeBaseId: args.knowledgeBaseId,
      moduleId: args.moduleId,
      content: args.content,
      embedding: args.embedding,
      tokenCount: args.tokenCount,
      chunkIndex: args.chunkIndex,
      sourceStart: args.sourceStart,
      sourceEnd: args.sourceEnd,
      parserVersion: args.parserVersion,
      embeddingModel: args.embeddingModel,
      embeddingDimensions: args.embeddingDimensions,
      searchText: args.searchText,
      searchVersion: args.searchVersion,
      embeddingOpenAi1536: args.embeddingOpenAi1536,
      modulePath: args.modulePath,
      modulePathText: args.modulePathText,
      scopeIds: args.scopeIds,
      documentTitle: args.documentTitle,
      headingPath: args.headingPath,
      pageStart: args.pageStart,
      pageEnd: args.pageEnd,
    })
  },
})

export const backfillSearchFields = internalMutation({
  args: {
    limit: v.optional(v.number()),
    dryRun: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const limit = Math.min(Math.max(args.limit ?? 100, 1), 500)
    const chunks = await ctx.db
      .query("documentChunks")
      .filter((q) => q.neq(q.field("searchVersion"), SEARCH_VERSION))
      .take(limit)
    const metadataByKnowledgeBaseId = new Map<
      string,
      {
        modulePathById: Map<string, string[]>
        scopeIdsById: Map<string, string[]>
      }
    >()

    async function getMetadata(knowledgeBaseId: Id<"knowledgeBases">) {
      const existing = metadataByKnowledgeBaseId.get(knowledgeBaseId)
      if (existing) return existing

      const modules = await ctx.db
        .query("modules")
        .withIndex("by_knowledgeBaseId", (q) =>
          q.eq("knowledgeBaseId", knowledgeBaseId)
        )
        .take(5000)
      const moduleById = new Map(modules.map((mod) => [mod._id, mod]))
      const modulePathById = new Map<string, string[]>()
      const scopeIdsById = new Map<string, string[]>()

      function getModulePath(moduleId: Id<"modules"> | undefined): string[] {
        if (!moduleId) return []
        const existingPath = modulePathById.get(moduleId)
        if (existingPath) return existingPath
        const path: string[] = []
        let current = moduleById.get(moduleId)
        while (current) {
          path.unshift(current.name)
          current = current.parentId
            ? moduleById.get(current.parentId)
            : undefined
        }
        modulePathById.set(moduleId, path)
        return path
      }

      function getScopeIds(moduleId: Id<"modules"> | undefined): string[] {
        if (!moduleId) return []
        const existingScopeIds = scopeIdsById.get(moduleId)
        if (existingScopeIds) return existingScopeIds
        const ids: string[] = []
        let current = moduleById.get(moduleId)
        while (current) {
          ids.push(current._id)
          current = current.parentId
            ? moduleById.get(current.parentId)
            : undefined
        }
        scopeIdsById.set(moduleId, ids)
        return ids
      }

      for (const courseModule of modules) {
        getModulePath(courseModule._id)
        getScopeIds(courseModule._id)
      }

      const metadata = { modulePathById, scopeIdsById }
      metadataByKnowledgeBaseId.set(knowledgeBaseId, metadata)
      return metadata
    }

    if (!args.dryRun) {
      for (const chunk of chunks) {
        const document = await ctx.db.get(chunk.documentId)
        const metadata = await getMetadata(chunk.knowledgeBaseId)
        const modulePath = chunk.moduleId
          ? (metadata.modulePathById.get(chunk.moduleId) ?? [])
          : []
        const modulePathText = modulePath.join(" ")
        const scopeIds = chunk.moduleId
          ? (metadata.scopeIdsById.get(chunk.moduleId) ?? [])
          : []
        const documentTitle = document?.filename ?? chunk.documentTitle
        const searchText = normalizeSearchText(
          [
            documentTitle,
            modulePathText,
            chunk.headingPath?.join(" "),
            chunk.content,
          ]
            .filter(Boolean)
            .join("\n")
        )
        const embeddingOpenAi1536 =
          chunk.embeddingModel === OPENAI_EMBEDDING_MODEL &&
          chunk.embeddingDimensions === 1536
            ? chunk.embedding
            : undefined

        await ctx.db.patch(chunk._id, {
          searchText,
          searchVersion: SEARCH_VERSION,
          embeddingOpenAi1536,
          modulePath,
          modulePathText,
          scopeIds,
          documentTitle,
        })
      }
    }

    return {
      matched: chunks.length,
      updated: args.dryRun ? 0 : chunks.length,
      hasMore: chunks.length === limit,
    }
  },
})

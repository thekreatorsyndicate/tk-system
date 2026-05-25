import { v } from "convex/values"
import { internalMutation } from "./_generated/server"

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
      headingPath: args.headingPath,
      pageStart: args.pageStart,
      pageEnd: args.pageEnd,
    })
  },
})

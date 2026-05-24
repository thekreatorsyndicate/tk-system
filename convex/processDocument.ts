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
  },
  handler: async (ctx, args) => {
    const patch: Record<string, string | undefined> = {
      status: args.status,
    }
    if (args.errorMessage !== undefined) {
      patch.errorMessage = args.errorMessage
    }
    await ctx.db.patch("documents", args.documentId, patch)
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
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("documentChunks", {
      documentId: args.documentId,
      knowledgeBaseId: args.knowledgeBaseId,
      moduleId: args.moduleId,
      content: args.content,
      embedding: args.embedding,
      tokenCount: args.tokenCount,
    })
  },
})

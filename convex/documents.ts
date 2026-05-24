import { v } from "convex/values"
import { internalQuery, mutation, query } from "./_generated/server"
import { internal } from "./_generated/api"

export const list = query({
  args: { knowledgeBaseId: v.id("knowledgeBases") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("documents")
      .withIndex("by_knowledgeBaseId", (q) =>
        q.eq("knowledgeBaseId", args.knowledgeBaseId),
      )
      .order("desc")
      .collect()
  },
})

export const generateUploadUrl = mutation({
  args: {
    knowledgeBaseId: v.id("knowledgeBases"),
    moduleId: v.optional(v.id("modules")),
    filename: v.string(),
    contentType: v.string(),
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

    if (!profile || profile.role !== "coach") throw new Error("Not authorized")

    const kb = await ctx.db.get("knowledgeBases", args.knowledgeBaseId)
    if (!kb || kb.coachId !== profile._id) throw new Error("Not authorized")

    const storageId = await ctx.storage.generateUploadUrl()
    return { storageId }
  },
})

export const createRecord = mutation({
  args: {
    knowledgeBaseId: v.id("knowledgeBases"),
    moduleId: v.optional(v.id("modules")),
    storageId: v.id("_storage"),
    filename: v.string(),
    contentType: v.string(),
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

    if (!profile || profile.role !== "coach") throw new Error("Not authorized")

    const kb = await ctx.db.get("knowledgeBases", args.knowledgeBaseId)
    if (!kb || kb.coachId !== profile._id) throw new Error("Not authorized")

    const id = await ctx.db.insert("documents", {
      knowledgeBaseId: args.knowledgeBaseId,
      moduleId: args.moduleId,
      storageId: args.storageId,
      filename: args.filename,
      contentType: args.contentType,
      status: "uploading",
    })

    await ctx.scheduler.runAfter(0, internal.processDocumentAction.processDocument, {
      documentId: id,
    })

    return await ctx.db.get("documents", id)
  },
})

export const get = query({
  args: { id: v.id("documents") },
  handler: async (ctx, args) => {
    return await ctx.db.get("documents", args.id)
  },
})

export const remove = mutation({
  args: { id: v.id("documents") },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity()
    if (!identity) throw new Error("Not authenticated")

    const profile = await ctx.db
      .query("profiles")
      .withIndex("by_tokenIdentifier", (q) =>
        q.eq("tokenIdentifier", identity.tokenIdentifier),
      )
      .unique()

    if (!profile || profile.role !== "coach") throw new Error("Not authorized")

    const doc = await ctx.db.get("documents", args.id)
    if (!doc) throw new Error("Document not found")

    const kb = await ctx.db.get("knowledgeBases", doc.knowledgeBaseId)
    if (!kb || kb.coachId !== profile._id) throw new Error("Not authorized")

    const chunks = await ctx.db
      .query("documentChunks")
      .withIndex("by_documentId", (q) => q.eq("documentId", args.id))
      .collect()

    for (const chunk of chunks) {
      await ctx.db.delete("documentChunks", chunk._id)
    }

    await ctx.storage.delete(doc.storageId)
    await ctx.db.delete("documents", args.id)
  },
})

export const getInternal = internalQuery({
  args: { id: v.id("documents") },
  handler: async (ctx, args) => {
    return await ctx.db.get("documents", args.id)
  },
})

export const getStorageUrl = internalQuery({
  args: { storageId: v.id("_storage") },
  handler: async (ctx, args) => {
    return await ctx.storage.getUrl(args.storageId)
  },
})

import { v } from "convex/values"
import { mutation, query } from "./_generated/server"

export const list = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity()
    if (!identity) return []

    const profile = await ctx.db
      .query("profiles")
      .withIndex("by_tokenIdentifier", (q) =>
        q.eq("tokenIdentifier", identity.tokenIdentifier),
      )
      .unique()

    if (!profile) return []

    return await ctx.db
      .query("knowledgeBases")
      .withIndex("by_coachId", (q) => q.eq("coachId", profile._id))
      .order("desc")
      .collect()
  },
})

export const listPublished = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db
      .query("knowledgeBases")
      .withIndex("by_published", (q) => q.eq("isPublished", true))
      .order("desc")
      .collect()
  },
})

export const get = query({
  args: { id: v.id("knowledgeBases") },
  handler: async (ctx, args) => {
    return await ctx.db.get("knowledgeBases", args.id)
  },
})

export const create = mutation({
  args: {
    title: v.string(),
    description: v.optional(v.string()),
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
    if (profile.role !== "coach") throw new Error("Only coaches can create knowledge bases")

    const id = await ctx.db.insert("knowledgeBases", {
      title: args.title,
      description: args.description,
      coachId: profile._id,
      isPublished: false,
    })

    return await ctx.db.get("knowledgeBases", id)
  },
})

export const update = mutation({
  args: {
    id: v.id("knowledgeBases"),
    title: v.optional(v.string()),
    description: v.optional(v.string()),
    isPublished: v.optional(v.boolean()),
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

    const kb = await ctx.db.get("knowledgeBases", args.id)
    if (!kb || kb.coachId !== profile._id) throw new Error("Not authorized")

    const patch: Record<string, string | boolean> = {}
    if (args.title !== undefined) patch.title = args.title
    if (args.description !== undefined) patch.description = args.description
    if (args.isPublished !== undefined) patch.isPublished = args.isPublished

    await ctx.db.patch("knowledgeBases", args.id, patch)
    return await ctx.db.get("knowledgeBases", args.id)
  },
})

export const remove = mutation({
  args: { id: v.id("knowledgeBases") },
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

    const kb = await ctx.db.get("knowledgeBases", args.id)
    if (!kb || kb.coachId !== profile._id) throw new Error("Not authorized")

    const modules = await ctx.db
      .query("modules")
      .withIndex("by_knowledgeBaseId", (q) => q.eq("knowledgeBaseId", args.id))
      .collect()

    for (const mod of modules) {
      await ctx.db.delete("modules", mod._id)
    }

    const docs = await ctx.db
      .query("documents")
      .withIndex("by_knowledgeBaseId", (q) => q.eq("knowledgeBaseId", args.id))
      .collect()

    for (const doc of docs) {
      const chunks = await ctx.db
        .query("documentChunks")
        .withIndex("by_documentId", (q) => q.eq("documentId", doc._id))
        .collect()
      for (const chunk of chunks) {
        await ctx.db.delete("documentChunks", chunk._id)
      }
      await ctx.db.delete("documents", doc._id)
      await ctx.storage.delete(doc.storageId)
    }

    const conversations = await ctx.db
      .query("conversations")
      .withIndex("by_knowledgeBaseId", (q) =>
        q.eq("knowledgeBaseId", args.id),
      )
      .collect()

    for (const conv of conversations) {
      const msgs = await ctx.db
        .query("messages")
        .withIndex("by_conversationId", (q) => q.eq("conversationId", conv._id))
        .collect()
      for (const msg of msgs) {
        await ctx.db.delete("messages", msg._id)
      }
      await ctx.db.delete("conversations", conv._id)
    }

    await ctx.db.delete("knowledgeBases", args.id)
  },
})

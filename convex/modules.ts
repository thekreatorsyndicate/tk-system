import { v } from "convex/values"
import { mutation, query } from "./_generated/server"
import type { Doc } from "./_generated/dataModel"

type ModuleNode = Doc<"modules"> & {
  children: ModuleNode[]
}

export const list = query({
  args: { knowledgeBaseId: v.id("knowledgeBases") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("modules")
      .withIndex("by_knowledgeBaseId", (q) =>
        q.eq("knowledgeBaseId", args.knowledgeBaseId),
      )
      .order("asc")
      .collect()
  },
})

export const getTree = query({
  args: { knowledgeBaseId: v.id("knowledgeBases") },
  handler: async (ctx, args) => {
    const allModules = await ctx.db
      .query("modules")
      .withIndex("by_knowledgeBaseId", (q) =>
        q.eq("knowledgeBaseId", args.knowledgeBaseId),
      )
      .order("asc")
      .collect()

    const sorted = [...allModules].sort((a, b) => {
      if (a.order !== b.order) return a.order - b.order
      return a._creationTime - b._creationTime
    })

    function childrenOf(parentId: string | undefined): ModuleNode[] {
      return sorted
        .filter((m) => m.parentId === parentId)
        .map((m) => ({
          ...m,
          children: childrenOf(m._id),
        }))
    }

    return childrenOf(undefined)
  },
})

export const create = mutation({
  args: {
    knowledgeBaseId: v.id("knowledgeBases"),
    name: v.string(),
    description: v.optional(v.string()),
    parentId: v.optional(v.id("modules")),
    order: v.optional(v.number()),
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

    let order = args.order
    if (order === undefined) {
      const existing = await ctx.db
        .query("modules")
        .withIndex("by_knowledgeBaseId_parentId", (q) =>
          q
            .eq("knowledgeBaseId", args.knowledgeBaseId)
            .eq("parentId", args.parentId ?? undefined),
        )
        .collect()
      order = existing.length
    }

    const id = await ctx.db.insert("modules", {
      knowledgeBaseId: args.knowledgeBaseId,
      name: args.name,
      description: args.description,
      parentId: args.parentId,
      order,
    })

    return await ctx.db.get("modules", id)
  },
})

export const update = mutation({
  args: {
    id: v.id("modules"),
    name: v.optional(v.string()),
    description: v.optional(v.string()),
    order: v.optional(v.number()),
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

    const mod = await ctx.db.get("modules", args.id)
    if (!mod) throw new Error("Module not found")

    const kb = await ctx.db.get("knowledgeBases", mod.knowledgeBaseId)
    if (!kb || kb.coachId !== profile._id) throw new Error("Not authorized")

    const patch: Record<string, string | number> = {}
    if (args.name !== undefined) patch.name = args.name
    if (args.description !== undefined) patch.description = args.description
    if (args.order !== undefined) patch.order = args.order

    await ctx.db.patch("modules", args.id, patch)
    return await ctx.db.get("modules", args.id)
  },
})

export const remove = mutation({
  args: { id: v.id("modules") },
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

    const mod = await ctx.db.get("modules", args.id)
    if (!mod) throw new Error("Module not found")

    const kb = await ctx.db.get("knowledgeBases", mod.knowledgeBaseId)
    if (!kb || kb.coachId !== profile._id) throw new Error("Not authorized")

    const children = await ctx.db
      .query("modules")
      .withIndex("by_knowledgeBaseId_parentId", (q) =>
        q.eq("knowledgeBaseId", mod.knowledgeBaseId).eq("parentId", args.id),
      )
      .collect()

    for (const child of children) {
      const childDocs = await ctx.db
        .query("documents")
        .withIndex("by_moduleId", (q) => q.eq("moduleId", child._id))
        .collect()

      for (const doc of childDocs) {
        await ctx.db.patch("documents", doc._id, { moduleId: undefined })
      }

      await ctx.db.delete("modules", child._id)
    }

    const docs = await ctx.db
      .query("documents")
      .withIndex("by_moduleId", (q) => q.eq("moduleId", args.id))
      .collect()

    for (const doc of docs) {
      await ctx.db.patch("documents", doc._id, { moduleId: undefined })
    }

    await ctx.db.delete("modules", args.id)
  },
})

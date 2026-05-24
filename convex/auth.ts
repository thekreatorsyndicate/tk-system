import { v } from "convex/values"
import { mutation, query } from "./_generated/server"

export const getMe = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity()
    if (!identity) return null
    return await ctx.db
      .query("profiles")
      .withIndex("by_tokenIdentifier", (q) =>
        q.eq("tokenIdentifier", identity.tokenIdentifier),
      )
      .unique()
  },
})

export const getOrCreateProfile = mutation({
  args: {
    name: v.optional(v.string()),
    email: v.optional(v.string()),
    imageUrl: v.optional(v.string()),
    role: v.optional(v.union(v.literal("coach"), v.literal("student"))),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity()
    if (!identity) throw new Error("Not authenticated")

    const existing = await ctx.db
      .query("profiles")
      .withIndex("by_tokenIdentifier", (q) =>
        q.eq("tokenIdentifier", identity.tokenIdentifier),
      )
      .unique()

    if (existing) return existing

    const profileId = await ctx.db.insert("profiles", {
      name: args.name ?? identity.name ?? identity.email ?? "Unknown",
      email: args.email ?? identity.email ?? "",
      tokenIdentifier: identity.tokenIdentifier,
      imageUrl: args.imageUrl ?? identity.pictureUrl,
      role: args.role ?? "student",
    })

    return await ctx.db.get("profiles", profileId)
  },
})

export const updateProfile = mutation({
  args: {
    name: v.optional(v.string()),
    imageUrl: v.optional(v.string()),
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

    const patch: Record<string, string> = {}
    if (args.name !== undefined) patch.name = args.name
    if (args.imageUrl !== undefined) patch.imageUrl = args.imageUrl

    await ctx.db.patch("profiles", profile._id, patch)
    return await ctx.db.get("profiles", profile._id)
  },
})

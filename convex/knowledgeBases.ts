import { v } from "convex/values"
import { mutation, query } from "./_generated/server"
import type { Doc, Id } from "./_generated/dataModel"
import type { MutationCtx, QueryCtx } from "./_generated/server"
import {
  getAccessibleKnowledgeBase,
  getCurrentProfile,
  getOwnedKnowledgeBase,
  requireCurrentProfile,
  requireOwnedKnowledgeBase,
} from "./lib/authz"

type PublishReadinessCtx =
  | Pick<QueryCtx, "db">
  | Pick<MutationCtx, "db">

function normalizeEmail(email: string) {
  return email.trim().toLowerCase()
}

async function getPublishReadiness(
  ctx: PublishReadinessCtx,
  knowledgeBase: Doc<"knowledgeBases">,
) {
  const documents = await ctx.db
    .query("documents")
    .withIndex("by_knowledgeBaseId", (q) =>
      q.eq("knowledgeBaseId", knowledgeBase._id as Id<"knowledgeBases">),
    )
    .collect()

  const hasDetails = knowledgeBase.title.trim().length > 0
  const hasDocuments = documents.length > 0
  const readyCount = documents.filter((doc) => doc.status === "ready").length
  const blockingCount = documents.filter((doc) =>
    doc.status === "uploading" || doc.status === "processing",
  ).length

  const blockingReasons = []
  if (!hasDetails) blockingReasons.push("Add a course title.")
  if (!hasDocuments) blockingReasons.push("Upload at least one document.")
  if (hasDocuments && readyCount === 0) {
    blockingReasons.push("Wait for at least one document to be ready.")
  }
  if (blockingCount > 0) {
    blockingReasons.push("Wait for uploading or processing documents to finish.")
  }

  return {
    canPublish: blockingReasons.length === 0,
    blockingReasons,
  }
}

export const list = query({
  args: {},
  handler: async (ctx) => {
    const profile = await getCurrentProfile(ctx)
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
    const profile = await getCurrentProfile(ctx)
    if (!profile) return []

    const accessible = new Map<Id<"knowledgeBases">, Doc<"knowledgeBases">>()

    const owned = await ctx.db
      .query("knowledgeBases")
      .withIndex("by_coachId", (q) => q.eq("coachId", profile._id))
      .collect()

    for (const kb of owned) {
      if (kb.isPublished) accessible.set(kb._id, kb)
    }

    const enrollments = await ctx.db
      .query("enrollments")
      .withIndex("by_profileId", (q) => q.eq("profileId", profile._id))
      .collect()

    for (const enrollment of enrollments) {
      const kb = await ctx.db.get(enrollment.knowledgeBaseId)
      if (kb?.isPublished) accessible.set(kb._id, kb)
    }

    return Array.from(accessible.values()).sort(
      (a, b) => b._creationTime - a._creationTime,
    )
  },
})

export const get = query({
  args: { id: v.id("knowledgeBases") },
  handler: async (ctx, args) => {
    return await getAccessibleKnowledgeBase(ctx, args.id)
  },
})

export const getForDashboard = query({
  args: { id: v.id("knowledgeBases") },
  handler: async (ctx, args) => {
    const result = await getOwnedKnowledgeBase(ctx, args.id)
    return result?.knowledgeBase ?? null
  },
})

export const create = mutation({
  args: {
    title: v.string(),
    description: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const profile = await requireCurrentProfile(ctx)
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
    const { knowledgeBase } = await requireOwnedKnowledgeBase(ctx, args.id)

    if (args.isPublished === true) {
      const nextKnowledgeBase = {
        ...knowledgeBase,
        title: args.title ?? knowledgeBase.title,
        description: args.description ?? knowledgeBase.description,
      }
      const readiness = await getPublishReadiness(ctx, nextKnowledgeBase)
      if (!readiness.canPublish) {
        throw new Error(
          `Cannot publish yet. ${readiness.blockingReasons.join(" ")}`,
        )
      }
    }

    const patch: Record<string, string | boolean> = {}
    if (args.title !== undefined) patch.title = args.title
    if (args.description !== undefined) patch.description = args.description
    if (args.isPublished !== undefined) patch.isPublished = args.isPublished

    await ctx.db.patch("knowledgeBases", args.id, patch)
    return await ctx.db.get("knowledgeBases", args.id)
  },
})

export const listEnrollments = query({
  args: { knowledgeBaseId: v.id("knowledgeBases") },
  handler: async (ctx, args) => {
    await requireOwnedKnowledgeBase(ctx, args.knowledgeBaseId)

    const enrollments = await ctx.db
      .query("enrollments")
      .withIndex("by_knowledgeBaseId", (q) =>
        q.eq("knowledgeBaseId", args.knowledgeBaseId),
      )
      .order("desc")
      .collect()

    return await Promise.all(
      enrollments.map(async (enrollment) => {
        const profile = await ctx.db.get(enrollment.profileId)
        return {
          ...enrollment,
          profile,
        }
      }),
    )
  },
})

export const enrollStudentByEmail = mutation({
  args: {
    knowledgeBaseId: v.id("knowledgeBases"),
    email: v.string(),
  },
  handler: async (ctx, args) => {
    const { profile: coach } = await requireOwnedKnowledgeBase(
      ctx,
      args.knowledgeBaseId,
    )
    if (coach.role !== "coach") throw new Error("Not authorized")

    const email = normalizeEmail(args.email)
    if (!email) throw new Error("Email is required")

    const student = await ctx.db
      .query("profiles")
      .withIndex("by_email", (q) => q.eq("email", email))
      .first()

    if (!student) {
      throw new Error(
        "No profile found for that email. Ask the student to sign in first.",
      )
    }

    const existing = await ctx.db
      .query("enrollments")
      .withIndex("by_profileId_and_knowledgeBaseId", (q) =>
        q
          .eq("profileId", student._id)
          .eq("knowledgeBaseId", args.knowledgeBaseId),
      )
      .unique()

    if (existing) return existing

    const id = await ctx.db.insert("enrollments", {
      profileId: student._id,
      knowledgeBaseId: args.knowledgeBaseId,
      enrolledByProfileId: coach._id,
      createdAt: Date.now(),
    })

    return await ctx.db.get("enrollments", id)
  },
})

export const removeEnrollment = mutation({
  args: { id: v.id("enrollments") },
  handler: async (ctx, args) => {
    const enrollment = await ctx.db.get(args.id)
    if (!enrollment) return

    await requireOwnedKnowledgeBase(ctx, enrollment.knowledgeBaseId)
    await ctx.db.delete(args.id)
  },
})

export const remove = mutation({
  args: { id: v.id("knowledgeBases") },
  handler: async (ctx, args) => {
    await requireOwnedKnowledgeBase(ctx, args.id)

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

    const enrollments = await ctx.db
      .query("enrollments")
      .withIndex("by_knowledgeBaseId", (q) =>
        q.eq("knowledgeBaseId", args.id),
      )
      .collect()

    for (const enrollment of enrollments) {
      await ctx.db.delete(enrollment._id)
    }

    await ctx.db.delete("knowledgeBases", args.id)
  },
})

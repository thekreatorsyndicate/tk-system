import type { Doc, Id } from "../_generated/dataModel"
import type { MutationCtx, QueryCtx } from "../_generated/server"

type AuthzCtx = Pick<QueryCtx, "auth" | "db"> | Pick<MutationCtx, "auth" | "db">

export async function getCurrentProfile(
  ctx: AuthzCtx,
): Promise<Doc<"profiles"> | null> {
  const identity = await ctx.auth.getUserIdentity()
  if (!identity) return null

  return await ctx.db
    .query("profiles")
    .withIndex("by_tokenIdentifier", (q) =>
      q.eq("tokenIdentifier", identity.tokenIdentifier),
    )
    .unique()
}

export async function requireCurrentProfile(
  ctx: AuthzCtx,
): Promise<Doc<"profiles">> {
  const profile = await getCurrentProfile(ctx)
  if (!profile) throw new Error("Profile not found")
  return profile
}

export async function getOwnedKnowledgeBase(
  ctx: AuthzCtx,
  id: Id<"knowledgeBases">,
): Promise<{
  profile: Doc<"profiles">
  knowledgeBase: Doc<"knowledgeBases">
} | null> {
  const profile = await getCurrentProfile(ctx)
  if (!profile) return null

  const knowledgeBase = await ctx.db.get(id)
  if (!knowledgeBase || knowledgeBase.coachId !== profile._id) return null

  return { profile, knowledgeBase }
}

export async function requireOwnedKnowledgeBase(
  ctx: AuthzCtx,
  id: Id<"knowledgeBases">,
): Promise<{
  profile: Doc<"profiles">
  knowledgeBase: Doc<"knowledgeBases">
}> {
  const result = await getOwnedKnowledgeBase(ctx, id)
  if (!result) throw new Error("Not authorized")
  return result
}

export async function getAccessibleKnowledgeBase(
  ctx: AuthzCtx,
  id: Id<"knowledgeBases">,
): Promise<Doc<"knowledgeBases"> | null> {
  const knowledgeBase = await ctx.db.get(id)
  if (!knowledgeBase) return null
  if (knowledgeBase.isPublished) return knowledgeBase

  const profile = await getCurrentProfile(ctx)
  if (profile && knowledgeBase.coachId === profile._id) return knowledgeBase

  return null
}

export async function requireAccessibleKnowledgeBase(
  ctx: AuthzCtx,
  id: Id<"knowledgeBases">,
): Promise<Doc<"knowledgeBases">> {
  const knowledgeBase = await getAccessibleKnowledgeBase(ctx, id)
  if (!knowledgeBase) throw new Error("Knowledge base not found")
  return knowledgeBase
}

import { query } from "./_generated/server"

export const checkAuth = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity()
    return {
      authenticated: identity !== null,
      subject: identity?.subject ?? null,
      tokenIdentifier: identity?.tokenIdentifier ?? null,
      issuer: identity?.issuer ?? null,
      name: identity?.name ?? null,
    }
  },
})

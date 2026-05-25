import { defineSchema, defineTable } from "convex/server"
import { v } from "convex/values"

export default defineSchema({
  profiles: defineTable({
    name: v.string(),
    email: v.string(),
    tokenIdentifier: v.string(),
    imageUrl: v.optional(v.string()),
    role: v.union(v.literal("coach"), v.literal("student")),
  }).index("by_tokenIdentifier", ["tokenIdentifier"]),

  knowledgeBases: defineTable({
    title: v.string(),
    description: v.optional(v.string()),
    coachId: v.id("profiles"),
    isPublished: v.boolean(),
  })
    .index("by_coachId", ["coachId"])
    .index("by_published", ["isPublished"]),

  modules: defineTable({
    knowledgeBaseId: v.id("knowledgeBases"),
    name: v.string(),
    description: v.optional(v.string()),
    parentId: v.optional(v.id("modules")),
    order: v.number(),
  })
    .index("by_knowledgeBaseId", ["knowledgeBaseId"])
    .index("by_knowledgeBaseId_parentId", ["knowledgeBaseId", "parentId"]),

  documents: defineTable({
    knowledgeBaseId: v.id("knowledgeBases"),
    moduleId: v.optional(v.id("modules")),
    storageId: v.id("_storage"),
    filename: v.string(),
    contentType: v.string(),
    documentType: v.optional(
      v.union(
        v.literal("pdf"),
        v.literal("docx"),
        v.literal("txt"),
        v.literal("md"),
      ),
    ),
    fileSize: v.optional(v.number()),
    parserVersion: v.optional(v.string()),
    embeddingModel: v.optional(v.string()),
    embeddingDimensions: v.optional(v.number()),
    chunkCount: v.optional(v.number()),
    processedAt: v.optional(v.number()),
    status: v.union(
      v.literal("uploading"),
      v.literal("processing"),
      v.literal("ready"),
      v.literal("error"),
    ),
    errorMessage: v.optional(v.string()),
  })
    .index("by_knowledgeBaseId", ["knowledgeBaseId"])
    .index("by_moduleId", ["moduleId"])
    .index("by_status", ["status"]),

  documentChunks: defineTable({
    documentId: v.id("documents"),
    knowledgeBaseId: v.id("knowledgeBases"),
    moduleId: v.optional(v.id("modules")),
    content: v.string(),
    embedding: v.array(v.number()),
    tokenCount: v.number(),
    chunkIndex: v.optional(v.number()),
    sourceStart: v.optional(v.number()),
    sourceEnd: v.optional(v.number()),
    parserVersion: v.optional(v.string()),
    embeddingModel: v.optional(v.string()),
    embeddingDimensions: v.optional(v.number()),
    headingPath: v.optional(v.array(v.string())),
    pageStart: v.optional(v.number()),
    pageEnd: v.optional(v.number()),
  })
    .index("by_documentId", ["documentId"])
    .index("by_documentId_and_chunkIndex", ["documentId", "chunkIndex"])
    .index("by_knowledgeBaseId", ["knowledgeBaseId"])
    .index("by_knowledgeBaseId_and_moduleId", ["knowledgeBaseId", "moduleId"])
    .index("by_moduleId", ["moduleId"]),

  conversations: defineTable({
    knowledgeBaseId: v.id("knowledgeBases"),
    userId: v.id("profiles"),
    title: v.string(),
    isActive: v.boolean(),
    pinnedModuleId: v.optional(v.id("modules")),
  })
    .index("by_knowledgeBaseId", ["knowledgeBaseId"])
    .index("by_userId_and_knowledgeBaseId", ["userId", "knowledgeBaseId"])
    .index("by_userId", ["userId"]),

  messages: defineTable({
    conversationId: v.id("conversations"),
    role: v.union(v.literal("user"), v.literal("assistant")),
    content: v.string(),
    sourceChunks: v.optional(
      v.array(
        v.object({
          chunkId: v.id("documentChunks"),
          documentId: v.id("documents"),
          moduleId: v.optional(v.id("modules")),
          modulePath: v.optional(v.array(v.string())),
          documentFilename: v.optional(v.string()),
          content: v.string(),
          score: v.number(),
        }),
      ),
    ),
  }).index("by_conversationId", ["conversationId"]),
})

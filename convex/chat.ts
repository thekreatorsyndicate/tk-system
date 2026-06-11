/* eslint-disable @typescript-eslint/no-explicit-any */

import { v } from "convex/values"
import { action, mutation, query } from "./_generated/server"
import { internal } from "./_generated/api"
import type { Id } from "./_generated/dataModel"
import {
  generateChatReply,
  generateEmbedding,
  generateMockEmbedding,
  getEmbeddingModel,
  MOCK_EMBEDDING_MODEL,
  OPENAI_EMBEDDING_MODEL,
  resolveAiProvider,
  TUTOR_CHAT_MAX_CONTINUATIONS,
  TUTOR_CHAT_MAX_OUTPUT_TOKENS,
} from "./lib/aiProviders"
import {
  getAccessibleKnowledgeBase,
  requireAccessibleKnowledgeBase,
} from "./lib/authz"
import {
  fuzzyTermScore,
  isRetrievalAnswerable,
  lexicalTermScore,
  parseExpandedSearchQuery,
  parseRerankedSearchResults,
  parseSearchQuery,
  shouldExpandQuery,
  type ExpandedSearchQuery,
  type ParsedSearchQuery,
  type SupportKind,
} from "./lib/retrieval"

type ChatSource = {
  sourceNumber: number
  chunkId: Id<"documentChunks">
  documentId: Id<"documents">
  moduleId?: Id<"modules">
  modulePath?: string[]
  headingPath?: string[]
  content: string
  score: number
  supportKind?: SupportKind
  supportReason?: string
  sourceKind: "direct" | "adjacent"
}

type CandidateChunk = {
  _id: Id<"documentChunks">
  documentId: Id<"documents">
  knowledgeBaseId: Id<"knowledgeBases">
  moduleId?: Id<"modules">
  content: string
  embedding: number[]
  embeddingModel?: string
  embeddingDimensions?: number
  searchText?: string
  searchVersion?: string
  embeddingOpenAi1536?: number[]
  documentTitle?: string
  modulePathText?: string
  chunkIndex?: number
  headingPath?: string[]
  modulePath?: string[]
  scopeIds?: string[]
  selectedScopeIds?: string[]
}

type RankedChunk = {
  chunk: CandidateChunk
  score: number
  vectorScore: number
  lexicalScore: number
  fuzzyScore: number
  fullTextScore: number
  expansionPenalty: number
  scopePriority: number
  supportKind: SupportKind
  supportReason?: string
}

type QueryEmbedding = {
  embedding: number[]
  embeddingModel: string
  weight: number
}

type ContextChunk = {
  chunk: CandidateChunk
  score: number
  sourceNumber: number
  sourceKind: "direct" | "adjacent"
  supportKind: SupportKind
  supportReason?: string
}

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0
  let dot = 0
  let normA = 0
  let normB = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]
    normA += a[i] * a[i]
    normB += b[i] * b[i]
  }
  const denominator = Math.sqrt(normA) * Math.sqrt(normB)
  if (denominator === 0) return 0
  return dot / denominator
}

const MAX_DIRECT_MATCHES = 6
const MAX_DIRECT_MATCHES_PER_DOCUMENT = 2
const MAX_DIRECT_MATCHES_PER_MODULE = 3
const MAX_CONTEXT_CHUNKS = 12
const ADJACENT_CHUNK_WINDOW = 1
const SIMILARITY_THRESHOLD = 0.5
const MOCK_SIMILARITY_THRESHOLD = 0.2
const SEARCH_CANDIDATE_LIMIT = 32
const VECTOR_CANDIDATE_LIMIT = 48
const RERANK_CANDIDATE_LIMIT = 20
const MAX_FALLBACK_SOURCE_CARDS = 3

function buildSystemPrompt(kbTitle: string): string {
  return `You are an AI tutor for the course "${kbTitle}".

Your job is to act as a teaching layer between the student and the course material.

Rules:
1. Answer only from the provided course excerpts.
2. Do not use outside knowledge.
3. Explain the answer in clear, student-friendly language.
4. When multiple sources are relevant, combine them into one coherent explanation.
5. Cite source numbers inline like [1] or [2] for factual claims, but only cite sources you actually use in the answer.
6. Refer to module/submodule names when identifying where information came from.
7. Do not mention filenames, document IDs, chunk IDs, embeddings, or retrieval internals.
8. If the excerpts do not support an answer, say: "I can only answer that if it appears in the course material. I could not find enough relevant material in this course to answer confidently."
9. If the retrieved excerpts answer the student's question indirectly, explain the connection clearly. Say that the answer is based only on the available course material.
10. Do not present indirect inferences as if the course explicitly stated them.
11. Prefer a concise teaching structure: direct answer first, explanation next, and key takeaways if useful.
12. Never invent missing facts.`
}

function buildMockReply(
  kbTitle: string,
  contextChunks: ContextChunk[]
): string {
  const directSource =
    contextChunks.find((source) => source.sourceKind === "direct") ??
    contextChunks[0]
  const excerpt = directSource.chunk.content
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 700)
  const source = getModuleLabel(directSource.chunk)
  return `Direct answer: Based on ${source} in "${kbTitle}", ${excerpt} [${directSource.sourceNumber}]\n\nKey takeaway: This answer is grounded in the course material from ${source}.`
}

function getScopePriority(
  chunk: CandidateChunk,
  pinnedModuleId: Id<"modules"> | undefined
): number {
  if (!pinnedModuleId) return 0
  const scopeIds: string[] = chunk.scopeIds ?? []
  const selectedScopeIds: string[] = chunk.selectedScopeIds ?? [pinnedModuleId]
  for (let i = 0; i < selectedScopeIds.length; i++) {
    if (scopeIds.includes(selectedScopeIds[i])) return i
  }
  return selectedScopeIds.length
}

function pickDirectMatches(
  scored: RankedChunk[],
  useMockAi: boolean
): RankedChunk[] {
  const threshold = useMockAi ? MOCK_SIMILARITY_THRESHOLD : SIMILARITY_THRESHOLD
  const matching = scored.filter((item) => item.score >= threshold)
  if (matching.length === 0) return []

  const sorted = matching.sort(
    (a, b) => a.scopePriority - b.scopePriority || b.score - a.score
  )
  const selected: RankedChunk[] = []
  const selectedIds = new Set<string>()
  const documentCounts = new Map<string, number>()
  const moduleCounts = new Map<string, number>()

  for (const item of sorted) {
    if (selected.length >= MAX_DIRECT_MATCHES) break

    const documentKey = item.chunk.documentId
    const moduleKey = item.chunk.moduleId ?? "course-level"
    const documentCount = documentCounts.get(documentKey) ?? 0
    const moduleCount = moduleCounts.get(moduleKey) ?? 0

    if (
      documentCount >= MAX_DIRECT_MATCHES_PER_DOCUMENT ||
      moduleCount >= MAX_DIRECT_MATCHES_PER_MODULE
    ) {
      continue
    }

    selected.push(item)
    selectedIds.add(item.chunk._id)
    documentCounts.set(documentKey, documentCount + 1)
    moduleCounts.set(moduleKey, moduleCount + 1)
  }

  for (const item of sorted) {
    if (selected.length >= MAX_DIRECT_MATCHES) break
    if (selectedIds.has(item.chunk._id)) continue
    selected.push(item)
  }

  return selected
}

function expandWithAdjacentChunks(args: {
  selected: RankedChunk[]
  adjacentChunks: CandidateChunk[]
  window: number
  maxChunks: number
}): ContextChunk[] {
  const byDocumentAndIndex = new Map<string, CandidateChunk>()
  for (const chunk of args.adjacentChunks) {
    if (typeof chunk.chunkIndex !== "number") continue
    byDocumentAndIndex.set(`${chunk.documentId}:${chunk.chunkIndex}`, chunk)
  }

  const contextChunks: ContextChunk[] = []
  const seenChunkIds = new Set<string>()

  function addContextChunk(
    chunk: CandidateChunk,
    ranked: RankedChunk,
    sourceNumber: number,
    sourceKind: "direct" | "adjacent"
  ) {
    if (seenChunkIds.has(chunk._id)) return
    seenChunkIds.add(chunk._id)
    contextChunks.push({
      chunk,
      score: ranked.score,
      sourceNumber,
      sourceKind,
      supportKind:
        sourceKind === "adjacent" ? "background" : ranked.supportKind,
      supportReason: ranked.supportReason,
    })
  }

  for (let i = 0; i < args.selected.length; i++) {
    if (contextChunks.length >= args.maxChunks) break

    const ranked = args.selected[i]
    const sourceNumber = i + 1
    addContextChunk(ranked.chunk, ranked, sourceNumber, "direct")

    if (typeof ranked.chunk.chunkIndex !== "number") continue

    for (let offset = -args.window; offset <= args.window; offset++) {
      if (offset === 0 || contextChunks.length >= args.maxChunks) continue

      const adjacent = byDocumentAndIndex.get(
        `${ranked.chunk.documentId}:${ranked.chunk.chunkIndex + offset}`
      )
      if (!adjacent) continue
      if (adjacent.knowledgeBaseId !== ranked.chunk.knowledgeBaseId) continue
      if (adjacent.embeddingModel !== ranked.chunk.embeddingModel) continue
      if (adjacent.embeddingDimensions !== ranked.chunk.embeddingDimensions) {
        continue
      }

      addContextChunk(adjacent, ranked, sourceNumber, "adjacent")
    }
  }

  return contextChunks
}

function getModuleLabel(chunk: CandidateChunk): string {
  return chunk.modulePath && chunk.modulePath.length > 0
    ? chunk.modulePath.join(" > ")
    : "Course-level material"
}

function buildContextMessage(contextChunks: ContextChunk[], question: string) {
  const context = contextChunks
    .map((contextChunk) => {
      const sourceLabel =
        contextChunk.sourceKind === "adjacent"
          ? `[Source ${contextChunk.sourceNumber} - adjacent context]`
          : `[Source ${contextChunk.sourceNumber}]`
      const sourceType =
        contextChunk.sourceKind === "adjacent"
          ? "surrounding context"
          : "direct match"
      return `${sourceLabel}
Module: ${getModuleLabel(contextChunk.chunk)}
Type: ${sourceType}
Support: ${getSupportLabel(contextChunk)}
Excerpt:
${contextChunk.chunk.content}`
    })
    .join("\n\n")

  return `Here are the relevant course excerpts for the current question:

${context}

Now answer the following question based ONLY on the excerpts above. Cite source numbers inline and use module/submodule names when helpful. Do not use external knowledge.
Only cite a source number if that source directly supports the sentence or paragraph where the citation appears.
If the excerpts answer the question indirectly, explain the connection and state that the answer is based only on the available course material.

${question}`
}

function getSupportLabel(contextChunk: ContextChunk): string {
  return contextChunk.supportReason
    ? `${contextChunk.supportKind} (${contextChunk.supportReason})`
    : contextChunk.supportKind
}

function extractCitedSourceNumbers(reply: string): Set<number> {
  const cited = new Set<number>()
  const citationMatches = reply.matchAll(/\[([\d,\s-]+)\]/g)

  for (const match of citationMatches) {
    for (const value of match[1].split(",")) {
      const trimmed = value.trim()
      const range = trimmed.match(/^(\d+)\s*-\s*(\d+)$/)
      if (range) {
        const start = Number(range[1])
        const end = Number(range[2])
        if (
          Number.isInteger(start) &&
          Number.isInteger(end) &&
          start > 0 &&
          end >= start &&
          end - start <= MAX_DIRECT_MATCHES
        ) {
          for (let sourceNumber = start; sourceNumber <= end; sourceNumber++) {
            cited.add(sourceNumber)
          }
        }
        continue
      }

      const sourceNumber = Number(trimmed)
      if (Number.isInteger(sourceNumber) && sourceNumber > 0) {
        cited.add(sourceNumber)
      }
    }
  }

  return cited
}

function isUnsupportedReply(reply: string): boolean {
  const normalized = reply.toLowerCase().replace(/\s+/g, " ").trim()
  return [
    "i can only answer that if it appears in the course material",
    "i could not find enough relevant material",
    "can't access compatible course material",
    "cannot access compatible course material",
    "course material is not ready",
    "not enough relevant material in this course",
  ].some((marker) => normalized.includes(marker))
}

function buildSources(
  contextChunks: ContextChunk[],
  citedSourceNumbers: Set<number>
): ChatSource[] {
  const directModuleBySourceNumber = new Map<number, string>()
  const validSourceNumbers = new Set(
    contextChunks.map((contextChunk) => contextChunk.sourceNumber)
  )
  for (const contextChunk of contextChunks) {
    if (contextChunk.sourceKind === "direct") {
      directModuleBySourceNumber.set(
        contextChunk.sourceNumber,
        getModuleLabel(contextChunk.chunk)
      )
    }
  }

  function toSource(contextChunk: ContextChunk): ChatSource {
    return {
      sourceNumber: contextChunk.sourceNumber,
      chunkId: contextChunk.chunk._id,
      documentId: contextChunk.chunk.documentId,
      moduleId: contextChunk.chunk.moduleId,
      modulePath: contextChunk.chunk.modulePath,
      headingPath: contextChunk.chunk.headingPath,
      content: contextChunk.chunk.content.slice(0, 260),
      score: contextChunk.score,
      supportKind: contextChunk.supportKind,
      supportReason: contextChunk.supportReason,
      sourceKind: contextChunk.sourceKind,
    }
  }

  function shouldIncludeSource(contextChunk: ContextChunk): boolean {
    if (!citedSourceNumbers.has(contextChunk.sourceNumber)) return false

    if (
      contextChunk.sourceKind === "adjacent" &&
      directModuleBySourceNumber.get(contextChunk.sourceNumber) ===
        getModuleLabel(contextChunk.chunk)
    ) {
      return false
    }

    return true
  }

  const hasValidCitations = Array.from(citedSourceNumbers).some(
    (sourceNumber) => validSourceNumbers.has(sourceNumber)
  )
  const citedSources = hasValidCitations
    ? contextChunks.filter(shouldIncludeSource).map(toSource)
    : []
  if (citedSources.length > 0) return citedSources

  return contextChunks
    .filter((contextChunk) => contextChunk.sourceKind === "direct")
    .slice(0, MAX_FALLBACK_SOURCE_CARDS)
    .map(toSource)
}

function getRetrievalSearchQueries(
  question: string,
  parsedQuery: ParsedSearchQuery,
  expandedQuery?: ExpandedSearchQuery
): string[] {
  const queries = [
    question,
    parsedQuery.normalized,
    ...parsedQuery.phrases,
    ...(expandedQuery?.searchQueries ?? []),
    ...(expandedQuery?.adjacentConcepts ?? []),
  ]

  return Array.from(
    new Set(queries.map((query) => query.trim()).filter(Boolean))
  ).slice(0, 8)
}

function getRetrievalTerms(
  parsedQuery: ParsedSearchQuery,
  expandedQuery?: ExpandedSearchQuery
): string[] {
  const expandedTerms = expandedQuery
    ? parseSearchQuery(
        [
          expandedQuery.canonicalQuestion,
          ...expandedQuery.searchQueries,
          ...expandedQuery.adjacentConcepts,
        ].join(" ")
      ).terms
    : []

  return Array.from(new Set([...parsedQuery.terms, ...expandedTerms]))
}

async function getTextSearchChunkIds(
  ctx: any,
  knowledgeBaseId: Id<"knowledgeBases">,
  queries: string[]
): Promise<Set<string>> {
  const ids = new Set<string>()

  for (const query of queries) {
    try {
      const chunks: CandidateChunk[] = await ctx.runQuery(
        internal.chatInternal.searchChunksByText,
        {
          knowledgeBaseId,
          query,
          limit: SEARCH_CANDIDATE_LIMIT,
        }
      )
      for (const chunk of chunks) {
        ids.add(chunk._id)
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unknown text search error"
      console.warn(`Text search failed, using fallback scoring: ${message}`)
      return ids
    }
  }

  return ids
}

async function getVectorSearchChunkIds(args: {
  ctx: any
  knowledgeBaseId: Id<"knowledgeBases">
  queryEmbeddings: QueryEmbedding[]
  useMockAi: boolean
}): Promise<Set<string>> {
  const ids = new Set<string>()

  if (args.useMockAi) {
    return ids
  }

  for (const queryEmbedding of args.queryEmbeddings) {
    if (
      queryEmbedding.embeddingModel !== OPENAI_EMBEDDING_MODEL ||
      queryEmbedding.embedding.length !== 1536
    ) {
      continue
    }

    try {
      const results = await args.ctx.vectorSearch(
        "documentChunks",
        "by_embeddingOpenAi1536",
        {
          vector: queryEmbedding.embedding,
          limit: VECTOR_CANDIDATE_LIMIT,
          filter: (q: any) => q.eq("knowledgeBaseId", args.knowledgeBaseId),
        }
      )

      for (const result of results) {
        ids.add(result._id)
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unknown vector search error"
      console.warn(`Vector search failed, using fallback scoring: ${message}`)
    }
  }

  return ids
}

function getBestSemanticScore(
  queryEmbeddings: QueryEmbedding[],
  chunkEmbedding: number[]
): number {
  let bestScore = 0
  for (const queryEmbedding of queryEmbeddings) {
    if (queryEmbedding.embedding.length !== chunkEmbedding.length) continue
    bestScore = Math.max(
      bestScore,
      Math.max(0, cosineSimilarity(queryEmbedding.embedding, chunkEmbedding)) *
        queryEmbedding.weight
    )
  }
  return bestScore
}

async function rankRetrievalPass(args: {
  ctx: any
  question: string
  parsedQuery: ParsedSearchQuery
  expandedQuery?: ExpandedSearchQuery
  knowledgeBaseId: Id<"knowledgeBases">
  pinnedModuleId?: Id<"modules">
  queryEmbeddings: QueryEmbedding[]
  useMockAi: boolean
  expansionPenalty: number
}): Promise<{
  ranked: RankedChunk[]
  compatibleCount: number
  candidateCount: number
  usedFallbackScan: boolean
}> {
  const searchQueries = getRetrievalSearchQueries(
    args.question,
    args.parsedQuery,
    args.expandedQuery
  )
  const queryTerms = getRetrievalTerms(args.parsedQuery, args.expandedQuery)
  const textSearchIds = await getTextSearchChunkIds(
    args.ctx,
    args.knowledgeBaseId,
    searchQueries
  )
  const vectorSearchIds = await getVectorSearchChunkIds({
    ctx: args.ctx,
    knowledgeBaseId: args.knowledgeBaseId,
    queryEmbeddings: args.queryEmbeddings,
    useMockAi: args.useMockAi,
  })
  const primaryQueryEmbedding = args.queryEmbeddings[0]

  const indexedIds = Array.from(new Set([...textSearchIds, ...vectorSearchIds]))
  let usedFallbackScan = false
  let candidatePool: CandidateChunk[] = []

  if (indexedIds.length > 0 && !args.useMockAi) {
    candidatePool = await args.ctx.runQuery(
      internal.chatInternal.getReadyChunkContextByIds,
      {
        knowledgeBaseId: args.knowledgeBaseId,
        pinnedModuleId: args.pinnedModuleId,
        ids: indexedIds,
      }
    )
  } else {
    usedFallbackScan = true
    candidatePool = await args.ctx.runQuery(
      internal.chatInternal.getCandidateChunks,
      {
        knowledgeBaseId: args.knowledgeBaseId,
        pinnedModuleId: args.pinnedModuleId,
      }
    )
  }

  const compatiblePool = candidatePool.filter(
    (chunk) =>
      chunk.embeddingModel === primaryQueryEmbedding.embeddingModel &&
      chunk.embeddingDimensions === primaryQueryEmbedding.embedding.length
  )

  const scored = compatiblePool.map((chunk) => {
    const semanticScore = getBestSemanticScore(
      args.queryEmbeddings,
      chunk.embedding
    )
    const contentForText = [
      chunk.modulePath?.join(" "),
      chunk.modulePathText,
      chunk.documentTitle,
      chunk.headingPath?.join(" "),
      chunk.searchText,
      chunk.content,
    ]
      .filter(Boolean)
      .join(" ")
    const lexicalScoreValue = Math.max(
      lexicalTermScore(queryTerms, contentForText),
      textSearchIds.has(chunk._id) ? 0.8 : 0
    )
    const fuzzyScoreValue = fuzzyTermScore(queryTerms, contentForText)
    const scopePriority = getScopePriority(chunk, args.pinnedModuleId)
    const scopeBoost = args.pinnedModuleId ? 1 / (scopePriority + 1) : 0

    const score = args.useMockAi
      ? 0.45 * lexicalScoreValue + 0.35 * fuzzyScoreValue + 0.2 * scopeBoost
      : args.expansionPenalty > 0
        ? 0.5 * semanticScore +
          0.25 * lexicalScoreValue +
          0.15 * fuzzyScoreValue +
          0.05 * scopeBoost -
          0.05 * args.expansionPenalty
        : 0.55 * semanticScore +
          0.25 * lexicalScoreValue +
          0.15 * fuzzyScoreValue +
          0.05 * scopeBoost

    const supportKind: SupportKind =
      score >= 0.7 || lexicalScoreValue >= 0.8 ? "direct" : "indirect"

    return {
      chunk,
      score,
      vectorScore: semanticScore,
      lexicalScore: lexicalScoreValue,
      fullTextScore: lexicalScoreValue,
      fuzzyScore: fuzzyScoreValue,
      expansionPenalty: args.expansionPenalty,
      scopePriority,
      supportKind,
    }
  })

  return {
    ranked: scored.sort(
      (a, b) => a.scopePriority - b.scopePriority || b.score - a.score
    ),
    compatibleCount: compatiblePool.length,
    candidateCount: candidatePool.length,
    usedFallbackScan,
  }
}

function mergeRankedChunks(first: RankedChunk[], second: RankedChunk[]) {
  const byChunkId = new Map<string, RankedChunk>()
  for (const ranked of [...first, ...second]) {
    const existing = byChunkId.get(ranked.chunk._id)
    if (!existing || ranked.score > existing.score) {
      byChunkId.set(ranked.chunk._id, ranked)
    }
  }

  return Array.from(byChunkId.values()).sort(
    (a, b) => a.scopePriority - b.scopePriority || b.score - a.score
  )
}

function buildQueryExpansionMessages(question: string) {
  return [
    {
      role: "system" as const,
      content: `You rewrite student questions into search queries for course material retrieval.

Return only JSON.

Given the student's question, produce:
- canonicalQuestion: a clearer version of the question
- searchQueries: 2 to 4 short search queries
- adjacentConcepts: concepts that could answer the question indirectly
- mustNotAssume: facts that are not stated by the user

Rules:
1. Do not answer the question.
2. Do not invent course-specific facts.
3. Prefer concepts likely to appear in educational material.
4. Keep each search query under 12 words.
5. If the question is already specific, keep rewrites close to the original.`,
    },
    {
      role: "user" as const,
      content: question,
    },
  ]
}

async function expandRetrievalQuery(args: {
  question: string
  provider: "openai" | "gemini"
  openAiApiKey?: string
  geminiApiKey?: string
}): Promise<ExpandedSearchQuery | null> {
  try {
    const raw = await generateChatReply({
      provider: args.provider,
      messages: buildQueryExpansionMessages(args.question),
      openAiApiKey: args.openAiApiKey,
      geminiApiKey: args.geminiApiKey,
    })
    return parseExpandedSearchQuery(raw)
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown query expansion error"
    console.warn(`Query expansion failed, using first-pass retrieval: ${message}`)
    return null
  }
}

async function generateExpandedQueryEmbeddings(args: {
  expandedQuery: ExpandedSearchQuery
  provider: "openai" | "gemini"
  expectedEmbeddingModel: string
  expectedDimensions: number
  openAiApiKey?: string
  geminiApiKey?: string
}): Promise<QueryEmbedding[]> {
  const queryTexts = Array.from(
    new Set([
      args.expandedQuery.canonicalQuestion,
      ...args.expandedQuery.searchQueries,
    ].filter(Boolean))
  ).slice(0, 4)
  const embeddings: QueryEmbedding[] = []

  for (const text of queryTexts) {
    try {
      const generated = await generateEmbedding({
        text,
        provider: args.provider,
        task: "query",
        openAiApiKey: args.openAiApiKey,
        geminiApiKey: args.geminiApiKey,
      })

      if (
        generated.embeddingModel !== args.expectedEmbeddingModel ||
        generated.embedding.length !== args.expectedDimensions
      ) {
        continue
      }

      embeddings.push({
        embedding: generated.embedding,
        embeddingModel: generated.embeddingModel,
        weight: 0.94,
      })
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unknown embedding error"
      console.warn(`Expanded query embedding failed: ${message}`)
    }
  }

  return embeddings
}

function shouldRerank(args: {
  ranked: RankedChunk[]
  expansionWasUsed: boolean
  useMockAi: boolean
}): boolean {
  if (args.useMockAi || args.ranked.length < 2) return false
  if (args.expansionWasUsed) return true
  const [first, second] = args.ranked
  if ((first?.score ?? 0) < 0.72) return true
  return first.score - second.score < 0.08
}

function buildRerankerMessages(question: string, candidates: RankedChunk[]) {
  const candidateText = candidates
    .map((candidate, index) => {
      const excerpt = candidate.chunk.content.replace(/\s+/g, " ").slice(0, 900)
      return `Candidate ${index + 1}
chunkId: ${candidate.chunk._id}
module: ${getModuleLabel(candidate.chunk)}
retrievalScore: ${candidate.score.toFixed(3)}
excerpt: ${excerpt}`
    })
    .join("\n\n")

  return [
    {
      role: "system" as const,
      content: `You rerank retrieved course excerpts for answering a student question.

Return only JSON with this shape:
{"results":[{"chunkId":"...","relevanceScore":0.0,"supportKind":"direct|indirect|background|irrelevant","reason":"short"}]}

Rules:
1. Do not answer the question.
2. Mark direct only when the excerpt itself supports an answer.
3. Mark indirect when the excerpt explains a mechanism or prerequisite that can answer by inference.
4. Mark background for weak context and irrelevant for unrelated excerpts.
5. Keep reasons under 20 words.`,
    },
    {
      role: "user" as const,
      content: `Question: ${question}

Candidates:
${candidateText}`,
    },
  ]
}

async function rerankTopChunks(args: {
  question: string
  ranked: RankedChunk[]
  provider: "openai" | "gemini"
  openAiApiKey?: string
  geminiApiKey?: string
}): Promise<RankedChunk[]> {
  const topCandidates = args.ranked.slice(0, RERANK_CANDIDATE_LIMIT)
  if (topCandidates.length === 0) return args.ranked

  try {
    const raw = await generateChatReply({
      provider: args.provider,
      messages: buildRerankerMessages(args.question, topCandidates),
      openAiApiKey: args.openAiApiKey,
      geminiApiKey: args.geminiApiKey,
    })
    const reranked = parseRerankedSearchResults(raw)
    const byChunkId = new Map(reranked.map((item) => [item.chunkId, item]))
    if (byChunkId.size === 0) return args.ranked

    const adjusted = args.ranked.map((ranked) => {
      const item = byChunkId.get(ranked.chunk._id)
      if (!item) return ranked
      const supportBoost =
        item.supportKind === "direct"
          ? 0.08
          : item.supportKind === "indirect"
            ? 0.03
            : item.supportKind === "irrelevant"
              ? -0.3
              : -0.08

      return {
        ...ranked,
        score: 0.72 * ranked.score + 0.28 * item.relevanceScore + supportBoost,
        supportKind: item.supportKind,
        supportReason: item.reason,
      }
    })

    return adjusted
      .filter((ranked) => ranked.supportKind !== "irrelevant")
      .sort((a, b) => a.scopePriority - b.scopePriority || b.score - a.score)
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown reranker error"
    console.warn(`Retrieval reranking failed, using weighted scores: ${message}`)
    return args.ranked
  }
}

// ── Public mutations ──

export const createConversation = mutation({
  args: {
    knowledgeBaseId: v.id("knowledgeBases"),
    title: v.optional(v.string()),
    pinnedModuleId: v.optional(v.id("modules")),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity()
    if (!identity) throw new Error("Not authenticated")

    const profile = await ctx.db
      .query("profiles")
      .withIndex("by_tokenIdentifier", (q) =>
        q.eq("tokenIdentifier", identity.tokenIdentifier)
      )
      .unique()

    if (!profile) throw new Error("Profile not found")

    const kb = await requireAccessibleKnowledgeBase(ctx, args.knowledgeBaseId)

    if (args.pinnedModuleId) {
      const pinnedModule = await ctx.db.get(args.pinnedModuleId)
      if (
        !pinnedModule ||
        pinnedModule.knowledgeBaseId !== args.knowledgeBaseId
      ) {
        throw new Error("Module not found")
      }
    }

    const id = await ctx.db.insert("conversations", {
      knowledgeBaseId: args.knowledgeBaseId,
      userId: profile._id,
      title: args.title ?? `Chat with ${kb.title}`,
      isActive: true,
      pinnedModuleId: args.pinnedModuleId,
    })

    return await ctx.db.get("conversations", id)
  },
})

export const listConversations = query({
  args: { knowledgeBaseId: v.id("knowledgeBases") },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity()
    if (!identity) return []

    const profile = await ctx.db
      .query("profiles")
      .withIndex("by_tokenIdentifier", (q) =>
        q.eq("tokenIdentifier", identity.tokenIdentifier)
      )
      .unique()

    if (!profile) return []

    const kb = await getAccessibleKnowledgeBase(ctx, args.knowledgeBaseId)
    if (!kb) return []

    const conversations = await ctx.db
      .query("conversations")
      .withIndex("by_userId_and_knowledgeBaseId", (q) =>
        q.eq("userId", profile._id).eq("knowledgeBaseId", args.knowledgeBaseId)
      )
      .order("desc")
      .take(50)

    const modules = await ctx.db
      .query("modules")
      .withIndex("by_knowledgeBaseId", (q) =>
        q.eq("knowledgeBaseId", args.knowledgeBaseId)
      )
      .collect()

    const moduleById = new Map(modules.map((mod) => [mod._id, mod]))

    function getModulePath(moduleId: Id<"modules"> | undefined): string[] {
      if (!moduleId) return []
      const path: string[] = []
      let current = moduleById.get(moduleId)
      while (current) {
        path.unshift(current.name)
        current = current.parentId
          ? moduleById.get(current.parentId)
          : undefined
      }
      return path
    }

    return conversations.map((conversation) => ({
      ...conversation,
      modulePath: getModulePath(conversation.pinnedModuleId),
    }))
  },
})

export const archiveConversation = mutation({
  args: {
    id: v.id("conversations"),
    isActive: v.boolean(),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity()
    if (!identity) throw new Error("Not authenticated")

    const profile = await ctx.db
      .query("profiles")
      .withIndex("by_tokenIdentifier", (q) =>
        q.eq("tokenIdentifier", identity.tokenIdentifier)
      )
      .unique()
    if (!profile) throw new Error("Profile not found")

    const conversation = await ctx.db.get(args.id)
    if (!conversation || conversation.userId !== profile._id) {
      throw new Error("Not authorized")
    }

    await ctx.db.patch(args.id, { isActive: args.isActive })
    return await ctx.db.get(args.id)
  },
})

export const deleteConversation = mutation({
  args: { id: v.id("conversations") },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity()
    if (!identity) throw new Error("Not authenticated")

    const profile = await ctx.db
      .query("profiles")
      .withIndex("by_tokenIdentifier", (q) =>
        q.eq("tokenIdentifier", identity.tokenIdentifier)
      )
      .unique()
    if (!profile) throw new Error("Profile not found")

    const conversation = await ctx.db.get(args.id)
    if (!conversation || conversation.userId !== profile._id) {
      throw new Error("Not authorized")
    }

    const messages = await ctx.db
      .query("messages")
      .withIndex("by_conversationId", (q) => q.eq("conversationId", args.id))
      .collect()

    for (const message of messages) {
      await ctx.db.delete(message._id)
    }

    await ctx.db.delete(args.id)
  },
})

export const getConversation = query({
  args: { id: v.id("conversations") },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity()
    if (!identity) return null

    const profile = await ctx.db
      .query("profiles")
      .withIndex("by_tokenIdentifier", (q) =>
        q.eq("tokenIdentifier", identity.tokenIdentifier)
      )
      .unique()
    if (!profile) return null

    const conversation = await ctx.db.get(args.id)
    if (!conversation || conversation.userId !== profile._id) return null

    const kb = await getAccessibleKnowledgeBase(ctx, conversation.knowledgeBaseId)
    if (!kb) return null

    return conversation
  },
})

export const getMessages = query({
  args: { conversationId: v.id("conversations") },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity()
    if (!identity) return []

    const profile = await ctx.db
      .query("profiles")
      .withIndex("by_tokenIdentifier", (q) =>
        q.eq("tokenIdentifier", identity.tokenIdentifier)
      )
      .unique()
    if (!profile) return []

    const conversation = await ctx.db.get(args.conversationId)
    if (!conversation || conversation.userId !== profile._id) return []

    const kb = await getAccessibleKnowledgeBase(ctx, conversation.knowledgeBaseId)
    if (!kb) return []

    return await ctx.db
      .query("messages")
      .withIndex("by_conversationId", (q) =>
        q.eq("conversationId", args.conversationId)
      )
      .order("asc")
      .take(100)
  },
})

// ── Public action (external AI calls belong in actions, not mutations) ──

export const sendMessage = action({
  args: {
    conversationId: v.id("conversations"),
    content: v.string(),
  },
  handler: async (
    ctx,
    args
  ): Promise<{
    content: string
    sources: ChatSource[]
  }> => {
    const identity = await ctx.auth.getUserIdentity()
    if (!identity) throw new Error("Not authenticated")

    const profile = await ctx.runQuery(internal.chatInternal.getProfile, {
      tokenIdentifier: identity.tokenIdentifier,
    })
    if (!profile) throw new Error("Profile not found")

    const conversation: any = await ctx.runQuery(
      internal.chatInternal.getConversation,
      {
        id: args.conversationId,
      }
    )
    if (!conversation) throw new Error("Conversation not found")
    if (conversation.userId !== profile._id) throw new Error("Not authorized")

    const kb: any = await ctx.runQuery(internal.chatInternal.getKB, {
      id: conversation.knowledgeBaseId,
    })
    if (!kb) throw new Error("Knowledge base not found")

    const canAccess: boolean = await ctx.runQuery(
      internal.chatInternal.canAccessKnowledgeBase,
      {
        profileId: profile._id,
        knowledgeBaseId: conversation.knowledgeBaseId,
      },
    )
    if (!canAccess) throw new Error("Not authorized")

    await ctx.runMutation(internal.chatInternal.insertMessage, {
      conversationId: args.conversationId,
      role: "user",
      content: args.content,
    })

    const openAiApiKey = process.env.OPENAI_API_KEY
    const geminiApiKey = process.env.GEMINI_API_KEY
    let provider = resolveAiProvider({
      requestedProvider: process.env.AI_PROVIDER,
      mockAi: process.env.MOCK_AI,
      openAiApiKey,
      geminiApiKey,
    })
    let useMockAi = provider === "mock"

    let queryEmbedding: number[]
    let queryEmbeddingModel = getEmbeddingModel(provider)
    if (useMockAi) {
      queryEmbedding = generateMockEmbedding(args.content)
    } else {
      try {
        const generated = await generateEmbedding({
          text: args.content,
          provider,
          task: "query",
          openAiApiKey,
          geminiApiKey,
        })
        queryEmbedding = generated.embedding
        queryEmbeddingModel = generated.embeddingModel
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Unknown embedding error"
        console.warn(
          `${provider} embedding failed, using mock chat: ${message}`
        )
        provider = "mock"
        useMockAi = true
        queryEmbeddingModel = MOCK_EMBEDDING_MODEL
        queryEmbedding = generateMockEmbedding(args.content)
      }
    }
    const baseQueryEmbeddings: QueryEmbedding[] = [
      {
        embedding: queryEmbedding,
        embeddingModel: queryEmbeddingModel,
        weight: 1,
      },
    ]

    const parsedQuery = parseSearchQuery(args.content)
    const firstPass = await rankRetrievalPass({
      ctx,
      question: args.content,
      parsedQuery,
      knowledgeBaseId: conversation.knowledgeBaseId,
      pinnedModuleId: conversation.pinnedModuleId,
      queryEmbeddings: baseQueryEmbeddings,
      useMockAi,
      expansionPenalty: 0,
    })

    if (firstPass.candidateCount === 0) {
      const notReady =
        "The course material is not ready yet. Please ask again after the uploaded documents finish processing."

      await ctx.runMutation(internal.chatInternal.insertMessage, {
        conversationId: args.conversationId,
        role: "assistant",
        content: notReady,
      })

      return { content: notReady, sources: [] }
    }

    let ranked = firstPass.ranked
    let directMatches = pickDirectMatches(ranked, useMockAi)
    let expansionWasUsed = false
    const topRanked = ranked[0]
    const shouldRunExpansion =
      !useMockAi &&
      shouldExpandQuery({
        directMatchesCount: directMatches.length,
        topScore: topRanked?.score ?? 0,
        topSemanticScore: topRanked?.vectorScore ?? 0,
        topLexicalScore: topRanked?.lexicalScore ?? 0,
      })

    if (shouldRunExpansion && (provider === "openai" || provider === "gemini")) {
      const expandedQuery = await expandRetrievalQuery({
        question: args.content,
        provider,
        openAiApiKey,
        geminiApiKey,
      })

      if (expandedQuery) {
        const expandedQueryEmbeddings = await generateExpandedQueryEmbeddings({
          expandedQuery,
          provider,
          expectedEmbeddingModel: queryEmbeddingModel,
          expectedDimensions: queryEmbedding.length,
          openAiApiKey,
          geminiApiKey,
        })
        const expandedPass = await rankRetrievalPass({
          ctx,
          question: args.content,
          parsedQuery,
          expandedQuery,
          knowledgeBaseId: conversation.knowledgeBaseId,
          pinnedModuleId: conversation.pinnedModuleId,
          queryEmbeddings: [
            ...baseQueryEmbeddings,
            ...expandedQueryEmbeddings,
          ],
          useMockAi,
          expansionPenalty: 1,
        })
        ranked = mergeRankedChunks(firstPass.ranked, expandedPass.ranked)
        expansionWasUsed = true
        directMatches = pickDirectMatches(ranked, useMockAi)
      }
    }

    if (
      shouldRerank({
        ranked,
        expansionWasUsed,
        useMockAi,
      }) &&
      (provider === "openai" || provider === "gemini")
    ) {
      ranked = await rerankTopChunks({
        question: args.content,
        ranked,
        provider,
        openAiApiKey,
        geminiApiKey,
      })
      directMatches = pickDirectMatches(ranked, useMockAi)
    }

    if (directMatches.length === 0) {
      const refusal: string =
        firstPass.compatibleCount === 0
          ? `I can't access compatible course material for "${kb.title}" yet. Please reprocess the uploaded documents for the selected AI provider, then ask again.`
          : "I can only answer that if it appears in the course material. I could not find enough relevant material in this course to answer confidently."

      await ctx.runMutation(internal.chatInternal.insertMessage, {
        conversationId: args.conversationId,
        role: "assistant",
        content: refusal,
      })

      return { content: refusal, sources: [] }
    }

    if (!isRetrievalAnswerable(directMatches)) {
      const refusal =
        "I can only answer that if it appears in the course material. I could not find enough relevant material in this course to answer confidently."

      await ctx.runMutation(internal.chatInternal.insertMessage, {
        conversationId: args.conversationId,
        role: "assistant",
        content: refusal,
      })

      return { content: refusal, sources: [] }
    }

    const adjacentMatches = directMatches.flatMap((match) =>
      typeof match.chunk.chunkIndex === "number"
        ? [
            {
              documentId: match.chunk.documentId,
              chunkIndex: match.chunk.chunkIndex,
            },
          ]
        : []
    )
    const adjacentChunks: CandidateChunk[] = await ctx.runQuery(
      internal.chatInternal.getAdjacentChunksForMatches,
      {
        knowledgeBaseId: conversation.knowledgeBaseId,
        pinnedModuleId: conversation.pinnedModuleId,
        queryEmbeddingModel,
        queryEmbeddingDimensions: queryEmbedding.length,
        matches: adjacentMatches,
      }
    )

    const contextChunks = expandWithAdjacentChunks({
      selected: directMatches,
      adjacentChunks,
      window: ADJACENT_CHUNK_WINDOW,
      maxChunks: MAX_CONTEXT_CHUNKS,
    })

    const systemPrompt = buildSystemPrompt(kb.title)

    const previousMessages = await ctx.runQuery(
      internal.chatInternal.getPreviousMessages,
      {
        conversationId: args.conversationId,
      }
    )

    const chatMessages = [
      { role: "system" as const, content: systemPrompt },
      ...previousMessages.map((m: any) => ({
        role: m.role as "user" | "assistant",
        content: m.content,
      })),
    ]

    const contextMessage = {
      role: "user" as const,
      content: buildContextMessage(contextChunks, args.content),
    }

    let reply: string
    if (useMockAi) {
      reply = buildMockReply(kb.title, contextChunks)
    } else {
      try {
        reply = await generateChatReply({
          provider,
          messages: [...chatMessages.slice(0, -1), contextMessage],
          openAiApiKey,
          geminiApiKey,
          options: {
            maxOutputTokens: TUTOR_CHAT_MAX_OUTPUT_TOKENS,
            continueOnLength: true,
            maxContinuations: TUTOR_CHAT_MAX_CONTINUATIONS,
          },
        })
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Unknown chat error"
        console.warn(`${provider} chat failed, using mock reply: ${message}`)
        reply = buildMockReply(kb.title, contextChunks)
      }
    }

    const citedSourceNumbers = extractCitedSourceNumbers(reply)
    const sources = isUnsupportedReply(reply)
      ? []
      : buildSources(contextChunks, citedSourceNumbers)

    await ctx.runMutation(internal.chatInternal.insertMessage, {
      conversationId: args.conversationId,
      role: "assistant",
      content: reply,
      sourceChunks: sources,
    })

    return { content: reply, sources }
  },
})

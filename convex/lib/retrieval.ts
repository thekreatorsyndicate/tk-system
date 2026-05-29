export const SEARCH_VERSION = "2026-05-29.1"

export type ParsedSearchQuery = {
  normalized: string
  terms: string[]
  phrases: string[]
}

export type ExpandedSearchQuery = {
  canonicalQuestion: string
  searchQueries: string[]
  adjacentConcepts: string[]
  mustNotAssume: string[]
}

export type RetrievalConfidenceSummary = {
  directMatchesCount: number
  topScore: number
  topSemanticScore: number
  topLexicalScore: number
}

export type SupportKind = "direct" | "indirect" | "background" | "irrelevant"

export type RerankedSearchResult = {
  chunkId: string
  relevanceScore: number
  supportKind: SupportKind
  reason?: string
}

const STOP_WORDS = new Set([
  "the",
  "and",
  "for",
  "with",
  "that",
  "this",
  "what",
  "how",
  "why",
  "when",
  "where",
  "about",
  "from",
  "into",
  "your",
  "you",
  "are",
  "can",
  "could",
  "would",
  "should",
  "does",
  "did",
  "make",
  "sure",
  "his",
  "her",
  "their",
  "they",
  "them",
  "have",
  "has",
  "had",
  "not",
  "but",
])

export function normalizeSearchText(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s"']/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

export function parseSearchQuery(message: string): ParsedSearchQuery {
  const normalized = normalizeSearchText(message)
  const phrases = Array.from(normalized.matchAll(/"([^"]+)"/g))
    .map((match) => match[1].trim())
    .filter((phrase) => phrase.length > 0)

  const withoutPhrases = normalized.replace(/"[^"]+"/g, " ")
  const terms = Array.from(new Set(tokenizeSearchText(withoutPhrases)))

  return { normalized, terms, phrases }
}

export function tokenizeSearchText(text: string): string[] {
  return normalizeSearchText(text)
    .replace(/"/g, " ")
    .split(/\s+/)
    .map(stemTerm)
    .filter((word) => word.length > 2 && !STOP_WORDS.has(word))
}

export function fuzzyTermScore(queryTerms: string[], content: string): number {
  if (queryTerms.length === 0) return 0

  const contentTerms = new Set(tokenizeSearchText(content))
  let score = 0

  for (const term of queryTerms.map(stemTerm)) {
    if (contentTerms.has(term)) {
      score += 1
      continue
    }

    if (term.length < 5) continue

    let fuzzyMatched = false
    const maxDistance = term.length > 8 ? 2 : 1
    for (const contentTerm of contentTerms) {
      if (Math.abs(contentTerm.length - term.length) > maxDistance) continue
      if (levenshteinDistance(term, contentTerm, maxDistance) <= maxDistance) {
        fuzzyMatched = true
        break
      }
    }

    if (fuzzyMatched) score += 0.75
  }

  return score / queryTerms.length
}

export function lexicalTermScore(queryTerms: string[], content: string): number {
  if (queryTerms.length === 0) return 0

  const contentTerms = new Set(tokenizeSearchText(content))
  let matches = 0
  for (const term of queryTerms.map(stemTerm)) {
    if (contentTerms.has(term)) matches++
  }

  return matches / queryTerms.length
}

export function shouldExpandQuery(summary: RetrievalConfidenceSummary): boolean {
  return (
    summary.directMatchesCount === 0 ||
    summary.topScore < 0.58 ||
    (summary.topSemanticScore >= 0.35 && summary.topLexicalScore === 0)
  )
}

export function parseExpandedSearchQuery(raw: string): ExpandedSearchQuery | null {
  const jsonText = extractJsonObject(raw)
  if (!jsonText) return null

  try {
    const parsed = JSON.parse(jsonText) as Partial<ExpandedSearchQuery>
    const searchQueries = normalizeStringArray(parsed.searchQueries)
      .map((query) => query.split(/\s+/).slice(0, 12).join(" "))
      .slice(0, 4)

    if (searchQueries.length === 0) return null

    return {
      canonicalQuestion:
        typeof parsed.canonicalQuestion === "string"
          ? parsed.canonicalQuestion.trim()
          : "",
      searchQueries,
      adjacentConcepts: normalizeStringArray(parsed.adjacentConcepts).slice(
        0,
        8
      ),
      mustNotAssume: normalizeStringArray(parsed.mustNotAssume).slice(0, 8),
    }
  } catch {
    return null
  }
}

export function parseRerankedSearchResults(
  raw: string
): RerankedSearchResult[] {
  const jsonText = extractJsonObject(raw)
  if (!jsonText) return []

  try {
    const parsed = JSON.parse(jsonText) as {
      results?: Array<Partial<RerankedSearchResult>>
    }
    if (!Array.isArray(parsed.results)) return []

    return parsed.results.flatMap((result) => {
      if (typeof result.chunkId !== "string") return []
      const supportKind = normalizeSupportKind(result.supportKind)
      const relevanceScore =
        typeof result.relevanceScore === "number"
          ? Math.min(Math.max(result.relevanceScore, 0), 1)
          : 0

      return {
        chunkId: result.chunkId,
        relevanceScore,
        supportKind,
        reason:
          typeof result.reason === "string"
            ? result.reason.trim().slice(0, 220)
            : undefined,
      }
    })
  } catch {
    return []
  }
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value
    .flatMap((item) => (typeof item === "string" ? [item.trim()] : []))
    .filter((item) => item.length > 0)
}

function extractJsonObject(raw: string): string | null {
  const start = raw.indexOf("{")
  const end = raw.lastIndexOf("}")
  if (start === -1 || end === -1 || end <= start) return null
  return raw.slice(start, end + 1)
}

function normalizeSupportKind(value: unknown): SupportKind {
  if (
    value === "direct" ||
    value === "indirect" ||
    value === "background" ||
    value === "irrelevant"
  ) {
    return value
  }

  return "background"
}

function stemTerm(term: string): string {
  if (term.length > 5 && term.endsWith("ies")) return `${term.slice(0, -3)}y`
  if (term.length > 5 && term.endsWith("ing")) return term.slice(0, -3)
  if (term.length > 4 && term.endsWith("ed")) return term.slice(0, -2)
  if (term.length > 4 && term.endsWith("es")) return term.slice(0, -2)
  if (term.length > 3 && term.endsWith("s")) return term.slice(0, -1)
  return term
}

function levenshteinDistance(a: string, b: string, maxDistance: number): number {
  const previous = Array.from({ length: b.length + 1 }, (_, index) => index)
  const current = Array.from({ length: b.length + 1 }, () => 0)

  for (let i = 1; i <= a.length; i++) {
    current[0] = i
    let rowMinimum = current[0]

    for (let j = 1; j <= b.length; j++) {
      const substitutionCost = a[i - 1] === b[j - 1] ? 0 : 1
      current[j] = Math.min(
        previous[j] + 1,
        current[j - 1] + 1,
        previous[j - 1] + substitutionCost
      )
      rowMinimum = Math.min(rowMinimum, current[j])
    }

    if (rowMinimum > maxDistance) return rowMinimum

    for (let j = 0; j <= b.length; j++) {
      previous[j] = current[j]
    }
  }

  return previous[b.length]
}

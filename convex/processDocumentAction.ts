"use node"

/* eslint-disable @typescript-eslint/no-explicit-any */

import { v } from "convex/values"
import { internalAction } from "./_generated/server"
import { internal } from "./_generated/api"
import PDFParser from "pdf2json"
import type {
  Output as PdfOutput,
  Page as PdfPage,
  Text as PdfText,
} from "pdf2json"
import mammoth from "mammoth"
import { inferDocumentType, type DocumentType } from "./lib/documentTypes"
import {
  generateEmbedding,
  getEmbeddingModel,
  MOCK_EMBEDDING_DIMENSIONS,
  OPENAI_EMBEDDING_MODEL,
  resolveAiProvider,
} from "./lib/aiProviders"
import { normalizeSearchText, SEARCH_VERSION } from "./lib/retrieval"

const TARGET_CHUNK_CHARS = 4000
const CHUNK_OVERLAP_CHARS = 800
const PARSER_VERSION = "2026-05-27.1"

type TextBlock = {
  text: string
  start: number
  end: number
  headingPath?: string[]
}

type TextChunk = {
  content: string
  sourceStart: number
  sourceEnd: number
  tokenCount: number
  headingPath?: string[]
}

function normalizeExtractedText(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[ \t]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
}

function estimateTokenCount(text: string): number {
  return text.split(/\s+/).filter(Boolean).length
}

function splitLongBlock(block: TextBlock): TextBlock[] {
  if (block.text.length <= TARGET_CHUNK_CHARS) return [block]

  const pieces: TextBlock[] = []
  const sentences = block.text.match(/[^.!?]+[.!?]+|\S[\s\S]*?(?=$)/g) ?? [
    block.text,
  ]
  let cursor = block.start
  let current = ""
  let currentStart = block.start

  for (const sentence of sentences) {
    const trimmed = sentence.trim()
    if (!trimmed) {
      cursor += sentence.length
      continue
    }

    if (current && current.length + trimmed.length + 1 > TARGET_CHUNK_CHARS) {
      pieces.push({
        text: current,
        start: currentStart,
        end: cursor,
        headingPath: block.headingPath,
      })
      current = ""
      currentStart = cursor
    }

    if (trimmed.length > TARGET_CHUNK_CHARS) {
      for (let i = 0; i < trimmed.length; i += TARGET_CHUNK_CHARS) {
        const text = trimmed.slice(i, i + TARGET_CHUNK_CHARS)
        pieces.push({
          text,
          start: cursor + i,
          end: cursor + i + text.length,
          headingPath: block.headingPath,
        })
      }
      cursor += trimmed.length
      currentStart = cursor
      continue
    }

    current = current ? `${current} ${trimmed}` : trimmed
    cursor += trimmed.length
  }

  if (current) {
    pieces.push({
      text: current,
      start: currentStart,
      end: cursor,
      headingPath: block.headingPath,
    })
  }

  return pieces
}

function extractHeadingPath(line: string, currentPath: string[]): string[] {
  const markdownHeading = /^(#{1,6})\s+(.+)$/.exec(line)
  if (!markdownHeading) return currentPath

  const depth = markdownHeading[1].length
  const title = markdownHeading[2].trim()
  return [...currentPath.slice(0, depth - 1), title]
}

function buildBlocks(text: string): TextBlock[] {
  const blocks: TextBlock[] = []
  let offset = 0
  let headingPath: string[] = []

  for (const paragraph of text.split(/\n{2,}/)) {
    const trimmed = paragraph.trim()
    const start = text.indexOf(trimmed, offset)
    const end = start + trimmed.length
    offset = end

    if (!trimmed) continue

    const firstLine = trimmed.split("\n")[0]
    headingPath = extractHeadingPath(firstLine, headingPath)

    blocks.push(
      ...splitLongBlock({
        text: trimmed,
        start,
        end,
        headingPath: headingPath.length > 0 ? headingPath : undefined,
      })
    )
  }

  return blocks
}

function getOverlapBlocks(blocks: TextBlock[]): TextBlock[] {
  const overlap: TextBlock[] = []
  let length = 0

  for (let i = blocks.length - 1; i >= 0; i--) {
    const nextLength = length + blocks[i].text.length
    if (overlap.length > 0 && nextLength > CHUNK_OVERLAP_CHARS) break
    overlap.unshift(blocks[i])
    length = nextLength
  }

  return overlap
}

function blocksToChunk(blocks: TextBlock[]): TextChunk {
  const content = blocks
    .map((block) => block.text)
    .join("\n\n")
    .trim()
  return {
    content,
    sourceStart: blocks[0].start,
    sourceEnd: blocks[blocks.length - 1].end,
    tokenCount: estimateTokenCount(content),
    headingPath: blocks[0].headingPath,
  }
}

function chunkText(rawText: string): TextChunk[] {
  const text = normalizeExtractedText(rawText)
  if (!text) return []

  const chunks: TextChunk[] = []
  let currentBlocks: TextBlock[] = []
  let currentLength = 0

  for (const block of buildBlocks(text)) {
    const separatorLength = currentBlocks.length > 0 ? 2 : 0
    const nextLength = currentLength + separatorLength + block.text.length

    if (currentBlocks.length > 0 && nextLength > TARGET_CHUNK_CHARS) {
      chunks.push(blocksToChunk(currentBlocks))
      currentBlocks = getOverlapBlocks(currentBlocks)
      currentLength = currentBlocks
        .map((overlapBlock) => overlapBlock.text.length)
        .reduce((total, length) => total + length, 0)
    }

    currentBlocks.push(block)
    currentLength += separatorLength + block.text.length
  }

  if (currentBlocks.length > 0) {
    chunks.push(blocksToChunk(currentBlocks))
  }

  return chunks.filter((chunk) => chunk.content.length > 0)
}

function decodePdfTextRun(text: string): string {
  const normalized = text.replace(/\u00a0/g, " ")
  if (!normalized.includes("%")) return normalized

  try {
    return decodeURIComponent(normalized)
  } catch {
    return normalized
  }
}

function getPdfTextBlockContent(block: PdfText): string {
  return block.R.map((run) => decodePdfTextRun(run.T)).join("")
}

function extractTextFromPdfPages(pages: PdfPage[]): string {
  return pages
    .map((page) => {
      const textBlocks = (page.Texts ?? [])
        .map((block) => ({
          x: block.x,
          y: block.y,
          text: getPdfTextBlockContent(block).trim(),
        }))
        .filter((block) => block.text.length > 0)

      textBlocks.sort((a, b) => a.y - b.y || a.x - b.x)

      const lines: { y: number; blocks: typeof textBlocks }[] = []
      for (const block of textBlocks) {
        const currentLine = lines[lines.length - 1]
        if (currentLine && Math.abs(currentLine.y - block.y) <= 0.35) {
          currentLine.blocks.push(block)
          currentLine.y = (currentLine.y + block.y) / 2
        } else {
          lines.push({ y: block.y, blocks: [block] })
        }
      }

      return lines
        .map((line) =>
          line.blocks
            .sort((a, b) => a.x - b.x)
            .map((block) => block.text)
            .join(" ")
        )
        .join("\n")
    })
    .filter((pageText) => pageText.trim().length > 0)
    .join("\n\n")
}

function extractTextFromPdfData(pdfData: PdfOutput): string {
  const structuredText = extractTextFromPdfPages(pdfData.Pages ?? [])
  return structuredText.trim()
}

function normalizePdfParserError(err: { parserError: Error } | Error): Error {
  if (err instanceof Error) return err
  return err.parserError instanceof Error
    ? err.parserError
    : new Error("PDF parsing failed")
}

function extractTextFromPdfBuffer(buffer: Buffer): Promise<string> {
  return new Promise((resolve, reject) => {
    const parser = new PDFParser()
    const parsedPages: PdfPage[] = []

    parser.on("data", (page) => {
      if (page) parsedPages.push(page)
    })
    parser.on("pdfParser_dataReady", (pdfData) => {
      const structuredText = extractTextFromPdfData(pdfData)
      const rawText = parser.getRawTextContent()
      resolve(structuredText || rawText)
    })
    parser.on("pdfParser_dataError", (err) => {
      const partialText = extractTextFromPdfPages(parsedPages)
      if (partialText.trim()) {
        resolve(partialText)
        return
      }
      reject(normalizePdfParserError(err))
    })
    parser.parseBuffer(buffer)
  })
}

async function extractTextFromStorage(
  ctx: any,
  storageId: string,
  contentType: string,
  filename: string,
  documentType?: DocumentType
): Promise<string> {
  const inferred = documentType
    ? { documentType }
    : inferDocumentType(filename, contentType)
  const url = await ctx.runQuery(internal.documents.getStorageUrl, {
    storageId: storageId as any,
  })
  if (!url) throw new Error("Failed to get storage URL")
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Failed to fetch file: ${res.statusText}`)

  if (inferred.documentType === "txt" || inferred.documentType === "md") {
    return await res.text()
  }

  if (inferred.documentType === "pdf") {
    const buffer = Buffer.from(await res.arrayBuffer())
    return await extractTextFromPdfBuffer(buffer)
  }

  if (inferred.documentType === "docx") {
    const buffer = Buffer.from(await res.arrayBuffer())
    const { value } = await mammoth.extractRawText({ buffer })
    return value
  }

  throw new Error(`Unsupported file type: ${contentType || filename}`)
}

async function cleanupDocumentChunks(ctx: any, documentId: string) {
  let hasMore = true
  while (hasMore) {
    hasMore = await ctx.runMutation(internal.processDocument.cleanupChunks, {
      documentId: documentId as any,
    })
  }
}

export const processDocument = internalAction({
  args: {
    documentId: v.id("documents"),
  },
  handler: async (ctx, args) => {
    const openAiApiKey = globalThis.process.env.OPENAI_API_KEY
    const geminiApiKey = globalThis.process.env.GEMINI_API_KEY
    const provider = resolveAiProvider({
      requestedProvider: globalThis.process.env.AI_PROVIDER,
      mockAi: globalThis.process.env.MOCK_AI,
      openAiApiKey,
      geminiApiKey,
    })

    const doc = await ctx.runQuery(internal.documents.getInternal, {
      id: args.documentId,
    })
    if (!doc) throw new Error("Document not found")

    await ctx.runMutation(internal.processDocument.updateStatus, {
      documentId: args.documentId,
      status: "processing",
      clearErrorMessage: true,
      parserVersion: PARSER_VERSION,
    })

    await cleanupDocumentChunks(ctx, args.documentId)

    try {
      const text = await extractTextFromStorage(
        ctx,
        doc.storageId,
        doc.contentType,
        doc.filename,
        doc.documentType
      )
      const chunks = chunkText(text)
      if (chunks.length === 0)
        throw new Error("No text content found in document")

      let embeddingModel = getEmbeddingModel(provider)
      let embeddingDimensions =
        provider === "mock" ? MOCK_EMBEDDING_DIMENSIONS : 0
      const moduleMetadata = await ctx.runQuery(
        internal.processDocument.getModuleMetadata,
        {
          knowledgeBaseId: doc.knowledgeBaseId,
          moduleId: doc.moduleId,
        }
      )

      for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex++) {
        const chunk = chunks[chunkIndex]
        const generated = await generateEmbedding({
          text: chunk.content,
          provider,
          task: "document",
          openAiApiKey,
          geminiApiKey,
        })
        embeddingModel = generated.embeddingModel
        embeddingDimensions = generated.embedding.length
        const searchText = normalizeSearchText(
          [
            doc.filename,
            moduleMetadata.modulePathText,
            chunk.headingPath?.join(" "),
            chunk.content,
          ]
            .filter(Boolean)
            .join("\n")
        )
        const embeddingOpenAi1536 =
          embeddingModel === OPENAI_EMBEDDING_MODEL &&
          generated.embedding.length === 1536
            ? generated.embedding
            : undefined

        await ctx.runMutation(internal.processDocument.storeChunk, {
          documentId: args.documentId,
          knowledgeBaseId: doc.knowledgeBaseId,
          moduleId: doc.moduleId,
          content: chunk.content,
          embedding: generated.embedding,
          tokenCount: chunk.tokenCount,
          chunkIndex,
          sourceStart: chunk.sourceStart,
          sourceEnd: chunk.sourceEnd,
          parserVersion: PARSER_VERSION,
          embeddingModel,
          embeddingDimensions,
          searchText,
          searchVersion: SEARCH_VERSION,
          embeddingOpenAi1536,
          modulePath: moduleMetadata.modulePath,
          modulePathText: moduleMetadata.modulePathText,
          scopeIds: moduleMetadata.scopeIds,
          documentTitle: doc.filename,
          headingPath: chunk.headingPath,
        })
      }

      await ctx.runMutation(internal.processDocument.updateStatus, {
        documentId: args.documentId,
        status: "ready",
        parserVersion: PARSER_VERSION,
        embeddingModel,
        embeddingDimensions,
        chunkCount: chunks.length,
        processedAt: Date.now(),
        clearErrorMessage: true,
      })
    } catch (error) {
      await cleanupDocumentChunks(ctx, args.documentId)

      const message = error instanceof Error ? error.message : "Unknown error"
      await ctx.runMutation(internal.processDocument.updateStatus, {
        documentId: args.documentId,
        status: "error",
        errorMessage: message,
        parserVersion: PARSER_VERSION,
        chunkCount: 0,
      })
      throw error
    }
  },
})

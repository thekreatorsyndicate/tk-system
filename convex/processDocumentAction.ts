"use node"

import { v } from "convex/values"
import { internalAction } from "./_generated/server"
import { internal } from "./_generated/api"
import PDFParser from "pdf2json"
import mammoth from "mammoth"

const CHUNK_SIZE = 1000
const CHUNK_OVERLAP = 200
const MOCK_EMBEDDING_DIMENSIONS = 64

function chunkText(text: string): string[] {
  const chunks: string[] = []
  let start = 0
  while (start < text.length) {
    const end = Math.min(start + CHUNK_SIZE, text.length)
    chunks.push(text.slice(start, end))
    start += CHUNK_SIZE - CHUNK_OVERLAP
  }
  return chunks
}

async function generateEmbedding(text: string, apiKey?: string): Promise<number[]> {
  if (!apiKey || globalThis.process.env.MOCK_AI !== "false") {
    return generateMockEmbedding(text)
  }

  const res = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: "text-embedding-3-small",
      input: text,
    }),
  })

  if (!res.ok) {
    const err = await res.text()
    console.warn(`OpenAI embedding failed, using mock embedding: ${err}`)
    return generateMockEmbedding(text)
  }

  const data = await res.json()
  return data.data[0].embedding
}

function generateMockEmbedding(text: string): number[] {
  const embedding = Array.from({ length: MOCK_EMBEDDING_DIMENSIONS }, () => 0)
  for (const word of tokenize(text)) {
    let hash = 0
    for (let i = 0; i < word.length; i++) {
      hash = (hash * 31 + word.charCodeAt(i)) | 0
    }
    embedding[Math.abs(hash) % MOCK_EMBEDDING_DIMENSIONS] += 1
  }
  const norm = Math.hypot(...embedding) || 1
  return embedding.map((value) => value / norm)
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((word) => word.length > 2)
}

function extractTextFromPdfBuffer(buffer: Buffer): Promise<string> {
  return new Promise((resolve, reject) => {
    const parser = new PDFParser()
    parser.on("pdfParser_dataReady", () => {
      const text = parser.getRawTextContent()
      resolve(text)
    })
    parser.on("pdfParser_dataError", (err) => {
      reject(err instanceof Error ? err : new Error("PDF parsing failed"))
    })
    parser.parseBuffer(buffer)
  })
}

async function extractTextFromStorage(
  ctx: any,
  storageId: string,
  contentType: string,
  filename: string,
): Promise<string> {
  const url = await ctx.runQuery(internal.documents.getStorageUrl, {
    storageId: storageId as any,
  })
  if (!url) throw new Error("Failed to get storage URL")
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Failed to fetch file: ${res.statusText}`)

  if (contentType === "text/plain" || contentType === "text/markdown") {
    return await res.text()
  }

  if (contentType === "application/pdf") {
    const buffer = Buffer.from(await res.arrayBuffer())
    return await extractTextFromPdfBuffer(buffer)
  }

  if (
    contentType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    filename.toLowerCase().endsWith(".docx")
  ) {
    const buffer = Buffer.from(await res.arrayBuffer())
    const { value } = await mammoth.extractRawText({ buffer })
    return value
  }

  throw new Error(`Unsupported file type: ${contentType || filename}`)
}

export const processDocument = internalAction({
  args: {
    documentId: v.id("documents"),
  },
  handler: async (ctx, args) => {
    const apiKey = globalThis.process.env.OPENAI_API_KEY

    const doc = await ctx.runQuery(internal.documents.getInternal, {
      id: args.documentId,
    })
    if (!doc) throw new Error("Document not found")

    await ctx.runMutation(internal.processDocument.updateStatus, {
      documentId: args.documentId,
      status: "processing",
    })

    try {
      const text = await extractTextFromStorage(
        ctx,
        doc.storageId,
        doc.contentType,
        doc.filename,
      )
      const chunks = chunkText(text.trim())
      if (chunks.length === 0) throw new Error("No text content found in document")

      for (const chunk of chunks) {
        const embedding = await generateEmbedding(chunk, apiKey)
        await ctx.runMutation(internal.processDocument.storeChunk, {
          documentId: args.documentId,
          knowledgeBaseId: doc.knowledgeBaseId,
          moduleId: doc.moduleId,
          content: chunk,
          embedding,
          tokenCount: chunk.split(/\s+/).length,
        })
      }

      await ctx.runMutation(internal.processDocument.updateStatus, {
        documentId: args.documentId,
        status: "ready",
      })
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unknown error"
      await ctx.runMutation(internal.processDocument.updateStatus, {
        documentId: args.documentId,
        status: "error",
        errorMessage: message,
      })
      throw error
    }
  },
})

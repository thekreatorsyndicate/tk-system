export type AiProvider = "mock" | "openai" | "gemini"
export type EmbeddingTask = "document" | "query"

export const MOCK_EMBEDDING_DIMENSIONS = 64
export const MOCK_EMBEDDING_MODEL = "mock-hash-64"
export const OPENAI_EMBEDDING_MODEL = "text-embedding-3-small"
export const OPENAI_CHAT_MODEL = "gpt-4o-mini"
export const GEMINI_EMBEDDING_MODEL = "gemini-embedding-001"
export const GEMINI_CHAT_MODEL = "gemini-2.5-flash"

type ResolveProviderArgs = {
  requestedProvider?: string
  mockAi?: string
  openAiApiKey?: string
  geminiApiKey?: string
}

type ChatMessage = {
  role: "system" | "user" | "assistant"
  content: string
}

export function resolveAiProvider(args: ResolveProviderArgs): AiProvider {
  if (args.mockAi !== "false") return "mock"

  const requestedProvider = args.requestedProvider?.toLowerCase()
  if (requestedProvider === "gemini") {
    return args.geminiApiKey ? "gemini" : "mock"
  }

  if (requestedProvider === "openai" || !requestedProvider) {
    return args.openAiApiKey ? "openai" : "mock"
  }

  return "mock"
}

export function getEmbeddingModel(provider: AiProvider): string {
  if (provider === "gemini") return GEMINI_EMBEDDING_MODEL
  if (provider === "openai") return OPENAI_EMBEDDING_MODEL
  return MOCK_EMBEDDING_MODEL
}

export function generateMockEmbedding(text: string): number[] {
  const embedding = Array.from({ length: MOCK_EMBEDDING_DIMENSIONS }, () => 0)
  for (const word of tokenizeForEmbedding(text)) {
    let hash = 0
    for (let i = 0; i < word.length; i++) {
      hash = (hash * 31 + word.charCodeAt(i)) | 0
    }
    embedding[Math.abs(hash) % MOCK_EMBEDDING_DIMENSIONS] += 1
  }
  const norm = Math.hypot(...embedding) || 1
  return embedding.map((value) => value / norm)
}

export async function generateEmbedding(args: {
  text: string
  provider: AiProvider
  task: EmbeddingTask
  openAiApiKey?: string
  geminiApiKey?: string
}): Promise<{ embedding: number[]; embeddingModel: string }> {
  if (args.provider === "mock") {
    return {
      embedding: generateMockEmbedding(args.text),
      embeddingModel: MOCK_EMBEDDING_MODEL,
    }
  }

  if (args.provider === "gemini") {
    return await generateGeminiEmbedding(
      args.text,
      args.task,
      args.geminiApiKey
    )
  }

  return await generateOpenAiEmbedding(args.text, args.openAiApiKey)
}

export async function generateChatReply(args: {
  messages: ChatMessage[]
  provider: AiProvider
  openAiApiKey?: string
  geminiApiKey?: string
}): Promise<string> {
  if (args.provider === "gemini") {
    return await generateGeminiChatReply(args.messages, args.geminiApiKey)
  }

  return await generateOpenAiChatReply(args.messages, args.openAiApiKey)
}

async function generateOpenAiEmbedding(
  text: string,
  apiKey: string | undefined
): Promise<{ embedding: number[]; embeddingModel: string }> {
  if (!apiKey) throw new Error("OPENAI_API_KEY is not configured")

  const res = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: OPENAI_EMBEDDING_MODEL,
      input: text,
    }),
  })

  if (!res.ok) {
    const err = await res.text()
    throw new Error(`OpenAI embedding failed: ${err}`)
  }

  const data = await res.json()
  return {
    embedding: data.data[0].embedding,
    embeddingModel: OPENAI_EMBEDDING_MODEL,
  }
}

async function generateGeminiEmbedding(
  text: string,
  task: EmbeddingTask,
  apiKey: string | undefined
): Promise<{ embedding: number[]; embeddingModel: string }> {
  if (!apiKey) throw new Error("GEMINI_API_KEY is not configured")

  const taskType = task === "query" ? "RETRIEVAL_QUERY" : "RETRIEVAL_DOCUMENT"
  const key = encodeURIComponent(apiKey)
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_EMBEDDING_MODEL}:embedContent?key=${key}`
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: `models/${GEMINI_EMBEDDING_MODEL}`,
      content: { parts: [{ text }] },
      taskType,
    }),
  })

  if (!res.ok) {
    const err = await res.text()
    throw new Error(`Gemini embedding failed: ${err}`)
  }

  const data = await res.json()
  return {
    embedding: data.embedding.values,
    embeddingModel: GEMINI_EMBEDDING_MODEL,
  }
}

async function generateOpenAiChatReply(
  messages: ChatMessage[],
  apiKey: string | undefined
): Promise<string> {
  if (!apiKey) throw new Error("OPENAI_API_KEY is not configured")

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: OPENAI_CHAT_MODEL,
      messages,
      temperature: 0.3,
      max_tokens: 1024,
    }),
  })

  if (!res.ok) {
    const err = await res.text()
    throw new Error(`OpenAI chat failed: ${err}`)
  }

  const data = await res.json()
  return data.choices[0].message.content
}

async function generateGeminiChatReply(
  messages: ChatMessage[],
  apiKey: string | undefined
): Promise<string> {
  if (!apiKey) throw new Error("GEMINI_API_KEY is not configured")

  const systemInstruction = messages.find(
    (message) => message.role === "system"
  )
  const contents = messages
    .filter((message) => message.role !== "system")
    .map((message) => ({
      role: message.role === "assistant" ? "model" : "user",
      parts: [{ text: message.content }],
    }))

  const key = encodeURIComponent(apiKey)
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_CHAT_MODEL}:generateContent?key=${key}`
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      systemInstruction: systemInstruction
        ? { parts: [{ text: systemInstruction.content }] }
        : undefined,
      contents,
      generationConfig: {
        temperature: 0.3,
        maxOutputTokens: 1024,
      },
    }),
  })

  if (!res.ok) {
    const err = await res.text()
    throw new Error(`Gemini chat failed: ${err}`)
  }

  const data = await res.json()
  const parts = data.candidates?.[0]?.content?.parts ?? []
  const text = parts
    .map((part: { text?: string }) => part.text ?? "")
    .join("")
    .trim()
  if (!text) throw new Error("Gemini chat returned an empty response")
  return text
}

function tokenizeForEmbedding(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((word) => word.length > 2)
}

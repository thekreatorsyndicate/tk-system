export const MAX_DOCUMENT_BYTES = 25 * 1024 * 1024

export const SUPPORTED_DOCUMENT_EXTENSIONS = [
  ".pdf",
  ".docx",
  ".txt",
  ".md",
] as const

export type DocumentType = "pdf" | "docx" | "txt" | "md"

type DocumentTypeConfig = {
  documentType: DocumentType
  canonicalContentType: string
  acceptedContentTypes: Set<string>
}

const genericContentTypes = new Set([
  "",
  "application/octet-stream",
  "binary/octet-stream",
])

const documentTypeByExtension: Record<
  (typeof SUPPORTED_DOCUMENT_EXTENSIONS)[number],
  DocumentTypeConfig
> = {
  ".pdf": {
    documentType: "pdf",
    canonicalContentType: "application/pdf",
    acceptedContentTypes: new Set(["application/pdf"]),
  },
  ".docx": {
    documentType: "docx",
    canonicalContentType:
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    acceptedContentTypes: new Set([
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ]),
  },
  ".txt": {
    documentType: "txt",
    canonicalContentType: "text/plain",
    acceptedContentTypes: new Set(["text/plain"]),
  },
  ".md": {
    documentType: "md",
    canonicalContentType: "text/markdown",
    acceptedContentTypes: new Set([
      "text/markdown",
      "text/x-markdown",
      "text/plain",
    ]),
  },
}

export function getDocumentExtension(filename: string) {
  const normalized = filename.trim().toLowerCase()
  const dotIndex = normalized.lastIndexOf(".")
  if (dotIndex === -1) return null
  return normalized.slice(dotIndex)
}

export function inferDocumentType(filename: string, contentType?: string) {
  const extension = getDocumentExtension(filename)
  if (!extension || !(extension in documentTypeByExtension)) {
    throw new Error(
      `Unsupported file type. Supported extensions: ${SUPPORTED_DOCUMENT_EXTENSIONS.join(", ")}`,
    )
  }

  const config =
    documentTypeByExtension[
      extension as keyof typeof documentTypeByExtension
    ]
  const normalizedContentType = (contentType ?? "").split(";")[0].trim().toLowerCase()

  if (
    normalizedContentType &&
    !genericContentTypes.has(normalizedContentType) &&
    !config.acceptedContentTypes.has(normalizedContentType)
  ) {
    throw new Error(
      `File extension ${extension} does not match content type ${contentType}`,
    )
  }

  return {
    documentType: config.documentType,
    contentType: genericContentTypes.has(normalizedContentType)
      ? config.canonicalContentType
      : normalizedContentType || config.canonicalContentType,
    canonicalContentType: config.canonicalContentType,
  }
}

export function validateDocumentUpload(
  filename: string,
  contentType?: string,
  size?: number,
) {
  const inferred = inferDocumentType(filename, contentType)

  if (size !== undefined && size > MAX_DOCUMENT_BYTES) {
    const maxMb = Math.floor(MAX_DOCUMENT_BYTES / 1024 / 1024)
    throw new Error(`File is too large. Maximum supported size is ${maxMb} MB.`)
  }

  return inferred
}

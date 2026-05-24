# TK System

TK System is an AI tutor platform for creating course knowledge bases and
letting students chat with course material. Coaches can organize modules,
upload source documents, publish courses, and preview the student experience.

## Stack

- Next.js 16 with React 19 and Tailwind CSS
- Convex for backend functions, database, file storage, and scheduled document processing
- Clerk for authentication
- OpenAI embeddings and chat, with mock AI fallback for local development
- shadcn/ui-compatible components and app styling

## Features

- Coach dashboard for creating and publishing knowledge bases
- Nested course modules and submodules
- PDF, DOCX, Markdown, and text document uploads
- Document extraction, chunking, and embedding storage in Convex
- Student chat experience scoped to the whole course or a selected module
- Conversation history with archive and delete controls
- Source snippets shown alongside assistant answers

## Getting Started

Install dependencies:

```bash
pnpm install
```

Create `.env.local` with the required Next.js configuration:

```bash
NEXT_PUBLIC_CONVEX_URL=
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=
CLERK_SECRET_KEY=
```

Configure Convex environment variables for document embeddings and chat:

```bash
npx convex env set MOCK_AI true
npx convex env set OPENAI_API_KEY your_openai_key
```

`OPENAI_API_KEY` is optional while `MOCK_AI` is not set to `false`.

Run the frontend:

```bash
pnpm dev
```

Run Convex in a separate terminal:

```bash
npx convex dev
```

Open `http://localhost:3000`.

## Development

Useful commands:

```bash
pnpm lint
pnpm typecheck
pnpm format
pnpm build
```

Convex functions live in `convex/`. Before changing Convex code, read
`convex/_generated/ai/guidelines.md`; this repo uses generated Convex AI
guidelines that override generic Convex assumptions.

Generated Convex API files are imported from `convex/_generated/`. Regenerate
them with `npx convex dev` after backend function or schema changes.

## AI Modes

By default, local development can run with `MOCK_AI=true`, which uses
deterministic mock embeddings and replies so the app works without paid model
calls. Set `MOCK_AI=false` and provide `OPENAI_API_KEY` to use OpenAI for
embeddings and chat responses.

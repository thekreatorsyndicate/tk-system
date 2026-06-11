import { afterEach, describe, expect, it, vi } from "vitest"

import {
  generateChatReply,
  TUTOR_CHAT_MAX_CONTINUATIONS,
  TUTOR_CHAT_MAX_OUTPUT_TOKENS,
} from "../convex/lib/aiProviders"

describe("AI provider chat replies", () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("continues OpenAI replies that stop at the output token limit", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            choices: [
              {
                finish_reason: "length",
                message: { content: "First half" },
              },
            ],
          }),
          { status: 200 }
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            choices: [
              {
                finish_reason: "stop",
                message: { content: "second half." },
              },
            ],
          }),
          { status: 200 }
        )
      )
    vi.stubGlobal("fetch", fetchMock)

    const reply = await generateChatReply({
      provider: "openai",
      openAiApiKey: "test-key",
      messages: [{ role: "user", content: "Explain the offer." }],
      options: {
        maxOutputTokens: TUTOR_CHAT_MAX_OUTPUT_TOKENS,
        continueOnLength: true,
        maxContinuations: TUTOR_CHAT_MAX_CONTINUATIONS,
      },
    })

    expect(reply).toBe("First half\n\nsecond half.")
    expect(fetchMock).toHaveBeenCalledTimes(2)

    const firstBody = JSON.parse(fetchMock.mock.calls[0][1].body as string)
    const secondBody = JSON.parse(fetchMock.mock.calls[1][1].body as string)

    expect(firstBody.max_tokens).toBe(TUTOR_CHAT_MAX_OUTPUT_TOKENS)
    expect(secondBody.messages.at(-1)).toMatchObject({
      role: "user",
      content:
        "Continue exactly where you left off. Do not repeat earlier text.",
    })
    expect(secondBody.messages.at(-2)).toMatchObject({
      role: "assistant",
      content: "First half",
    })
  })

  it("throws for short helper OpenAI replies that hit the token limit", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            choices: [
              {
                finish_reason: "length",
                message: { content: '{"results": [' },
              },
            ],
          }),
          { status: 200 }
        )
      )
    )

    await expect(
      generateChatReply({
        provider: "openai",
        openAiApiKey: "test-key",
        messages: [{ role: "user", content: "Return JSON." }],
      })
    ).rejects.toThrow("output token limit")
  })
})

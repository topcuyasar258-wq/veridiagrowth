import "server-only"

import type { EmailProvider, SendEmailInput, SendEmailResult } from "./provider"

type ResendResponse = {
  id?: string
}

export class ResendEmailProvider implements EmailProvider {
  constructor(
    private readonly input: {
      apiKey: string
      from: string
      replyTo?: string
      timeoutMs: number
      fetcher?: typeof fetch
    },
  ) {}

  async send(input: SendEmailInput): Promise<SendEmailResult> {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), this.input.timeoutMs)
    const fetcher = this.input.fetcher ?? fetch

    try {
      const response = await fetcher("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.input.apiKey}`,
          "Content-Type": "application/json",
          "Idempotency-Key": input.idempotencyKey,
        },
        body: JSON.stringify({
          from: this.input.from,
          to: input.to,
          subject: input.subject,
          html: input.html,
          text: input.text,
          reply_to: this.input.replyTo,
        }),
        signal: controller.signal,
      })

      if (response.ok) {
        const parsed = (await response.json()) as ResendResponse

        return {
          success: true,
          providerMessageId: parsed.id ?? input.idempotencyKey,
        }
      }

      if (response.status === 429) {
        return { success: false, retryable: true, code: "provider_429" }
      }

      if (response.status >= 500) {
        return { success: false, retryable: true, code: "provider_5xx" }
      }

      return {
        success: false,
        retryable: false,
        code: response.status === 400 ? "invalid_recipient" : "provider_4xx",
      }
    } catch (error) {
      return {
        success: false,
        retryable: isAbortError(error),
        code: isAbortError(error) ? "provider_timeout" : "network_error",
      }
    } finally {
      clearTimeout(timeout)
    }
  }
}

function isAbortError(error: unknown) {
  return (
    error instanceof Error &&
    (error.name === "AbortError" || error.message === "Aborted")
  )
}

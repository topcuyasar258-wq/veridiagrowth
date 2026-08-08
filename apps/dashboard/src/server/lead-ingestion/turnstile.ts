export type BotChallengeFailureReason =
  "invalid" | "expired" | "duplicate" | "provider_error" | "timeout"

export type BotChallengeResult =
  | {
      success: true
      provider: "cloudflare-turnstile"
      challengeTimestamp?: string
      hostname?: string
    }
  | {
      success: false
      reason: BotChallengeFailureReason
    }

export type BotChallengeProvider = {
  verify(input: {
    token: string
    remoteIp?: string
  }): Promise<BotChallengeResult>
}

type TurnstileResponse = {
  success?: boolean
  challenge_ts?: string
  hostname?: string
  "error-codes"?: string[]
}

export class CloudflareTurnstileProvider implements BotChallengeProvider {
  constructor(
    private readonly input: {
      secretKey: string
      timeoutMs: number
      endpoint?: string
      fetcher?: typeof fetch
    },
  ) {}

  async verify(input: {
    token: string
    remoteIp?: string
  }): Promise<BotChallengeResult> {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), this.input.timeoutMs)
    const fetcher = this.input.fetcher ?? fetch

    try {
      const body = new URLSearchParams({
        secret: this.input.secretKey,
        response: input.token,
      })

      if (input.remoteIp) {
        body.set("remoteip", input.remoteIp)
      }

      const response = await fetcher(
        this.input.endpoint ??
          "https://challenges.cloudflare.com/turnstile/v0/siteverify",
        {
          method: "POST",
          body,
          signal: controller.signal,
        },
      )

      if (!response.ok) {
        return { success: false, reason: "provider_error" }
      }

      const parsed = (await response.json()) as TurnstileResponse

      if (parsed.success === true) {
        return {
          success: true,
          provider: "cloudflare-turnstile",
          challengeTimestamp: parsed.challenge_ts,
          hostname: parsed.hostname,
        }
      }

      return {
        success: false,
        reason: mapTurnstileError(parsed["error-codes"] ?? []),
      }
    } catch (error) {
      return {
        success: false,
        reason: isAbortError(error) ? "timeout" : "provider_error",
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

function mapTurnstileError(errors: string[]): BotChallengeFailureReason {
  if (errors.includes("timeout-or-duplicate")) {
    return "duplicate"
  }

  if (errors.includes("expired-input-response")) {
    return "expired"
  }

  if (errors.includes("invalid-input-response")) {
    return "invalid"
  }

  if (errors.includes("bad-request")) {
    return "invalid"
  }

  if (errors.includes("missing-input-response")) {
    return "invalid"
  }

  return "provider_error"
}

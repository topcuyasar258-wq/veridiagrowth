import type { LeadRequestBody } from "./schema"

export type SpamDecision =
  | { accepted: false; code: "spam_honeypot" }
  | { accepted: true; suspicious: boolean; reasons: string[] }

export function evaluateSpamSignals(input: {
  body: LeadRequestBody
  minCompletionMs: number
}): SpamDecision {
  if (input.body.form.honeypot.trim().length > 0) {
    return { accepted: false, code: "spam_honeypot" }
  }

  const startedAt = new Date(input.body.form.startedAt)
  const submittedAt = new Date(input.body.form.submittedAt)
  const completionMs = submittedAt.getTime() - startedAt.getTime()

  if (!Number.isFinite(completionMs) || completionMs < 0) {
    return { accepted: false, code: "spam_honeypot" }
  }

  const reasons =
    completionMs < input.minCompletionMs ? ["form_completed_too_quickly"] : []

  return {
    accepted: true,
    suspicious: reasons.length > 0,
    reasons,
  }
}

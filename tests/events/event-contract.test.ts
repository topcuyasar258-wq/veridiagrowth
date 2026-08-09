import { describe, expect, it } from "vitest"

import {
  BACKEND_ONLY_EVENT_TYPES,
  EVENT_SCHEMA_VERSION,
  MAX_BATCH_SIZE,
  isForbiddenKey,
  validateInteractionBatch,
  validateInteractionEvent,
} from "@veridia/shared"

const NOW = new Date("2026-08-09T12:00:00.000Z")

function event(overrides: Record<string, unknown> = {}) {
  return {
    eventId: "evt_0123456789abcdef",
    eventType: "whatsapp_clicked",
    sessionId: "ses_0123456789abcdef",
    occurredAt: "2026-08-09T11:59:30.000Z",
    ...overrides,
  }
}

function batch(events: unknown[]) {
  return { schemaVersion: EVENT_SCHEMA_VERSION, events }
}

describe("validateInteractionEvent", () => {
  it("accepts the four public interaction types", () => {
    for (const eventType of [
      "session_started",
      "whatsapp_clicked",
      "phone_clicked",
      "form_started",
    ]) {
      const result = validateInteractionEvent(event({ eventType }), {
        now: NOW,
      })
      expect(result.ok).toBe(true)
    }
  })

  it("rejects lead_created with a dedicated reason", () => {
    // The browser must never be able to assert a Verified Lead.
    const result = validateInteractionEvent(
      event({ eventType: "lead_created" }),
      {
        now: NOW,
      },
    )

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.rejection.reason).toBe("backend_only_event_type")
  })

  it("rejects every backend-only event type", () => {
    for (const eventType of BACKEND_ONLY_EVENT_TYPES) {
      const result = validateInteractionEvent(event({ eventType }), {
        now: NOW,
      })
      expect(result.ok).toBe(false)
    }
  })

  it("rejects arbitrary custom event types", () => {
    const result = validateInteractionEvent(event({ eventType: "my_custom" }), {
      now: NOW,
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.rejection.reason).toBe("invalid_event_type")
  })

  it("rejects unknown top-level fields", () => {
    const result = validateInteractionEvent(event({ extra: "x" }), { now: NOW })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.rejection.reason).toBe("unknown_field")
  })

  it("rejects personal-data fields with a forbidden reason", () => {
    for (const key of ["email", "phone", "message", "firstName", "password"]) {
      const result = validateInteractionEvent(event({ [key]: "x" }), {
        now: NOW,
      })
      expect(result.ok).toBe(false)
      if (result.ok) continue
      expect(result.rejection.reason).toBe("forbidden_field")
    }
  })

  it("rejects arbitrary nested metadata", () => {
    const result = validateInteractionEvent(
      event({ metadata: { anything: "goes" } }),
      { now: NOW },
    )
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.rejection.reason).toBe("forbidden_field")
  })

  it("rejects malformed ids", () => {
    expect(
      validateInteractionEvent(event({ eventId: "short" }), { now: NOW }).ok,
    ).toBe(false)
    expect(
      validateInteractionEvent(event({ sessionId: "bad id!" }), { now: NOW })
        .ok,
    ).toBe(false)
  })

  it("rejects timestamps outside the accepted window", () => {
    const future = validateInteractionEvent(
      event({ occurredAt: "2026-08-09T12:10:00.000Z" }),
      { now: NOW },
    )
    expect(future.ok).toBe(false)
    if (!future.ok)
      expect(future.rejection.reason).toBe("occurred_at_in_future")

    const old = validateInteractionEvent(
      event({ occurredAt: "2026-08-01T00:00:00.000Z" }),
      { now: NOW },
    )
    expect(old.ok).toBe(false)
    if (!old.ok) expect(old.rejection.reason).toBe("occurred_at_too_old")
  })

  it("sanitizes page context and never keeps the raw URL", () => {
    const result = validateInteractionEvent(
      event({
        page: {
          url: "https://example.com/form?email=ada@example.com&utm_source=google",
          referrer: "https://www.google.com/search?q=secret",
        },
      }),
      { now: NOW },
    )

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.pageHost).toBe("example.com")
    expect(result.value.pagePath).toBe("/form")
    expect(result.value.referrerHost).toBe("www.google.com")
    expect(result.value.utm.utm_source).toBe("google")
    expect(JSON.stringify(result.value)).not.toContain("ada@example.com")
    expect(JSON.stringify(result.value)).not.toContain("secret")
  })

  it("rejects unknown keys inside page", () => {
    const result = validateInteractionEvent(
      event({ page: { url: "https://example.com/", title: "x" } }),
      { now: NOW },
    )
    expect(result.ok).toBe(false)
  })

  it("lets explicit attribution win over URL parameters", () => {
    const result = validateInteractionEvent(
      event({
        page: { url: "https://example.com/?utm_source=fromurl" },
        attribution: { utmSource: "stored", utmMedium: "cpc" },
      }),
      { now: NOW },
    )

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.utm.utm_source).toBe("stored")
    expect(result.value.utm.utm_medium).toBe("cpc")
  })

  it("rejects a phone number smuggled through attribution", () => {
    const result = validateInteractionEvent(
      event({ attribution: { whatsappNumber: "+905551112233" } }),
      { now: NOW },
    )
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.rejection.reason).toBe("forbidden_field")
  })
})

describe("validateInteractionBatch", () => {
  it("rejects a mismatched schema version", () => {
    const result = validateInteractionBatch(
      { schemaVersion: "1.0", events: [event()] },
      { now: NOW },
    )
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.rejection.reason).toBe("schema_version_mismatch")
  })

  it("accepts a batch at the maximum size", () => {
    const events = Array.from({ length: MAX_BATCH_SIZE }, (_, index) =>
      event({ eventId: `evt_${String(index).padStart(16, "0")}` }),
    )
    const result = validateInteractionBatch(batch(events), { now: NOW })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.events).toHaveLength(MAX_BATCH_SIZE)
  })

  it("rejects a batch over the maximum size", () => {
    const events = Array.from({ length: MAX_BATCH_SIZE + 1 }, (_, index) =>
      event({ eventId: `evt_${String(index).padStart(16, "0")}` }),
    )
    const result = validateInteractionBatch(batch(events), { now: NOW })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.rejection.reason).toBe("batch_too_large")
  })

  it("rejects an empty batch", () => {
    const result = validateInteractionBatch(batch([]), { now: NOW })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.rejection.reason).toBe("batch_empty")
  })

  it("collapses duplicate ids inside a batch instead of failing", () => {
    const result = validateInteractionBatch(batch([event(), event()]), {
      now: NOW,
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.events).toHaveLength(1)
    expect(result.value.droppedDuplicateIds).toEqual(["evt_0123456789abcdef"])
  })

  it("rejects the whole batch when any event is invalid", () => {
    const result = validateInteractionBatch(
      batch([event(), event({ eventId: "x", eventType: "lead_created" })]),
      { now: NOW },
    )
    expect(result.ok).toBe(false)
  })
})

describe("isForbiddenKey", () => {
  it("normalizes separators and case", () => {
    expect(isForbiddenKey("first_name")).toBe(true)
    expect(isForbiddenKey("First-Name")).toBe(true)
    expect(isForbiddenKey("PHONE")).toBe(true)
    expect(isForbiddenKey("utmSource")).toBe(false)
  })
})

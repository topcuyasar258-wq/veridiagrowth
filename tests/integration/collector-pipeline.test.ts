import type { SupabaseClient } from "@supabase/supabase-js"
import { beforeEach, describe, expect, it } from "vitest"

import type { Database } from "@veridia/database"

import { handleCollectRequest } from "../../apps/dashboard/src/server/interaction-collector/service"

/**
 * Collector pipeline integration.
 *
 * Drives the real pipeline -- site resolution, origin evaluation, validation,
 * quota consumption, risk scoring, storage -- against a fake Supabase client
 * that mirrors the RPC contracts. The RPCs themselves are verified against real
 * PostgreSQL by supabase/tests/interaction_collector.test.sql; this suite covers
 * the orchestration those pgTAP tests cannot reach.
 *
 * PII and raw-IP sentinels are asserted against everything the fake records, so
 * a leak into any database argument fails the test.
 */

const SITE_KEY = "vtk_abcdef0123456789abcdef0123456789"
const OTHER_SITE_KEY = "vtk_00000000000000000000000000000000"
const ORG_A = "10000000-0000-0000-0000-0000000000a1"
const SITE_A = "20000000-0000-0000-0000-0000000000a1"
const ORG_B = "10000000-0000-0000-0000-0000000000b1"
const SITE_B = "20000000-0000-0000-0000-0000000000b1"

const RAW_IP_SENTINEL = "203.0.113.123"
const PII_EMAIL = "phase2-pii@example.com"
const PII_PHONE = "+905551234567"
const PII_MESSAGE = "SECRET_FORM_MESSAGE_123"

const NOW = new Date("2026-08-09T12:00:00.000Z")

interface RpcCall {
  name: string
  args: Record<string, unknown>
}

interface StoredEvent {
  siteId: string
  eventId: string
  decision: string
}

class FakeClient {
  rpcCalls: RpcCall[] = []
  stored: StoredEvent[] = []
  quotaCounts = new Map<string, number>()
  /** Forces every quota scope far past its hard multiplier. */
  floodQuota = false

  private keys = new Map<string, { org: string; site: string }>([
    [SITE_KEY, { org: ORG_A, site: SITE_A }],
    [OTHER_SITE_KEY, { org: ORG_B, site: SITE_B }],
  ])

  domains = new Map<string, string[]>([
    [SITE_A, ["example.com"]],
    [SITE_B, ["other.example.com"]],
  ])

  /** Keys the resolver must refuse: revoked, unknown or belonging to a paused site. */
  revoked = new Set<string>()
  pausedSites = new Set<string>()

  from(table: string) {
    if (table !== "site_tracker_keys") {
      throw new Error(`unexpected table ${table}`)
    }

    let publicKey = ""

    const builder = {
      select: () => builder,
      eq: (column: string, value: string) => {
        if (column === "public_key") publicKey = value
        return builder
      },
      maybeSingle: async () => {
        const entry = this.keys.get(publicKey)

        if (!entry || this.revoked.has(publicKey)) {
          return { data: null, error: null }
        }

        return {
          data: {
            organization_id: entry.org,
            site_id: entry.site,
            status: "active",
            sites: {
              id: entry.site,
              status: this.pausedSites.has(entry.site) ? "paused" : "active",
              site_domains: (this.domains.get(entry.site) ?? []).map((d) => ({
                normalized_domain: d,
                status: "active",
                deleted_at: null,
              })),
            },
          },
          error: null,
        }
      },
    }

    return builder as never
  }

  async rpc(name: string, args: Record<string, unknown>) {
    this.rpcCalls.push({ name, args })

    if (name === "consume_event_quota") {
      const key = `${args.quota_scope}:${args.quota_scope_key}`
      const next =
        (this.quotaCounts.get(key) ?? 0) + Number(args.increment_by ?? 1)
      this.quotaCounts.set(key, next)

      const count = this.floodQuota ? Number(args.quota_limit) * 50 : next

      return {
        data: [
          {
            allowed: count <= Number(args.quota_limit),
            current_count: count,
            quota_limit_value: Number(args.quota_limit),
          },
        ],
        error: null,
      }
    }

    if (name === "ingest_interaction_event") {
      const siteId = String(args.target_site_id)
      const eventId = String(args.in_event_id)
      const decision = String(args.in_decision)

      if (decision === "rejected") return { data: "rejected", error: null }

      // Mirrors the per-site unique index.
      if (
        this.stored.some((e) => e.siteId === siteId && e.eventId === eventId)
      ) {
        return { data: "duplicate", error: null }
      }

      this.stored.push({ siteId, eventId, decision })
      return { data: decision, error: null }
    }

    if (name === "touch_site_tracker_deployment") {
      return { data: null, error: null }
    }

    throw new Error(`unexpected rpc ${name}`)
  }

  /** Every value that reached the database layer, for leak assertions. */
  recordedText() {
    return JSON.stringify(this.rpcCalls)
  }
}

function event(overrides: Record<string, unknown> = {}) {
  return {
    eventId: "evt_0123456789abcdef",
    eventType: "whatsapp_clicked",
    sessionId: "ses_0123456789abcdef",
    occurredAt: "2026-08-09T11:59:30.000Z",
    page: { url: "https://example.com/iletisim", referrer: null },
    trackerVersion: "0.1.0",
    ...overrides,
  }
}

function request(
  body: unknown,
  headers: Record<string, string> = { origin: "https://example.com" },
) {
  return new Request("https://collector.veridia.test/api/v1/collect", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "user-agent": "Mozilla/5.0",
      "x-forwarded-for": RAW_IP_SENTINEL,
      ...headers,
    },
    body: JSON.stringify(body),
  })
}

async function collect(
  client: FakeClient,
  body: unknown,
  headers?: Record<string, string>,
) {
  const req = request(body, headers)
  return handleCollectRequest({
    client: client as unknown as SupabaseClient<Database>,
    request: req,
    rawBodyText: await req.text(),
    now: NOW,
  })
}

function envelope(events: unknown[], siteKey = SITE_KEY) {
  return { schemaVersion: "2.0", siteKey, events }
}

describe("collector pipeline", () => {
  let client: FakeClient

  beforeEach(() => {
    client = new FakeClient()
  })

  it("accepts a valid event and stores it against the resolved tenant", async () => {
    const result = await collect(client, envelope([event()]))

    expect(result.status).toBe(202)
    if (result.status !== 202) return
    expect(result.summary).toEqual({
      accepted: 1,
      duplicate: 0,
      quarantined: 0,
      rejected: 0,
    })
    expect(client.stored).toHaveLength(1)
    expect(client.stored[0].siteId).toBe(SITE_A)
  })

  it("derives source category server side rather than trusting the client", async () => {
    await collect(
      client,
      envelope([
        event({
          page: {
            url: "https://example.com/x?utm_source=google&utm_medium=cpc",
            referrer: null,
          },
        }),
      ]),
    )

    const call = client.rpcCalls.find(
      (c) => c.name === "ingest_interaction_event",
    )
    expect(call?.args.in_source_category).toBe("paid_search")
  })

  it("never lets the client choose its tenant", async () => {
    // organizationId/siteId in the body must be ignored, not honoured.
    const result = await collect(client, {
      ...envelope([event()]),
      organizationId: ORG_B,
      siteId: SITE_B,
    })

    expect(result.status).toBe(202)
    expect(client.stored[0].siteId).toBe(SITE_A)
    const call = client.rpcCalls.find(
      (c) => c.name === "ingest_interaction_event",
    )
    expect(call?.args.target_site_id).toBe(SITE_A)
  })

  it("stores one interaction no matter how often an event is delivered", async () => {
    for (let index = 0; index < 20; index += 1) {
      await collect(client, envelope([event()]))
    }

    expect(client.stored).toHaveLength(1)
  })

  it("collapses duplicates inside a single batch", async () => {
    const result = await collect(client, envelope([event(), event()]))

    expect(result.status).toBe(202)
    if (result.status !== 202) return
    expect(result.summary.accepted).toBe(1)
    expect(result.summary.duplicate).toBe(1)
    expect(client.stored).toHaveLength(1)
  })

  it("keeps event ids independent across sites", async () => {
    await collect(client, envelope([event()]))
    await collect(client, envelope([event()], OTHER_SITE_KEY), {
      origin: "https://other.example.com",
    })

    expect(client.stored).toHaveLength(2)
    expect(client.stored.map((e) => e.siteId)).toEqual([SITE_A, SITE_B])
  })

  it("processes a full batch with a single site resolution", async () => {
    const events = Array.from({ length: 20 }, (_, index) =>
      event({ eventId: `evt_${String(index).padStart(16, "0")}` }),
    )
    const result = await collect(client, envelope(events))

    expect(result.status).toBe(202)
    if (result.status !== 202) return
    expect(result.summary.accepted).toBe(20)

    // Four quota scopes for the whole batch, not four per event.
    const quotaCalls = client.rpcCalls.filter(
      (c) => c.name === "consume_event_quota",
    )
    expect(quotaCalls).toHaveLength(4)
  })

  it("quarantines an event from an unconfigured origin", async () => {
    const result = await collect(client, envelope([event()]), {
      origin: "https://evil.com",
    })

    expect(result.status).toBe(202)
    if (result.status !== 202) return
    expect(result.summary.quarantined).toBe(1)
    expect(result.summary.accepted).toBe(0)
    expect(client.stored[0].decision).toBe("quarantined")
  })

  it("accepts an event with a missing origin", async () => {
    const result = await collect(client, envelope([event()]), {})

    expect(result.status).toBe(202)
    if (result.status !== 202) return
    expect(result.summary.accepted).toBe(1)
  })

  it("never echoes an unconfigured origin", async () => {
    const bad = await collect(client, envelope([event()]), {
      origin: "https://evil.com",
    })
    expect(bad.status === 202 && bad.allowedOrigin).toBeNull()

    const good = await collect(
      client,
      envelope([event({ eventId: "evt_1111111111111111" })]),
    )
    expect(good.status === 202 && good.allowedOrigin).toBe(
      "https://example.com",
    )
  })

  it("rejects an unknown site key without revealing whether it exists", async () => {
    const result = await collect(
      client,
      envelope([event()], "vtk_ffffffffffffffffffffffffffffffff"),
    )

    expect(result.status).toBe(404)
    if (result.status === 202) return
    expect(result.error).toBe("invalid_request")
    expect(client.stored).toHaveLength(0)
  })

  it("answers a revoked key exactly like an unknown one", async () => {
    client.revoked.add(SITE_KEY)
    const revoked = await collect(client, envelope([event()]))

    const fresh = new FakeClient()
    const unknown = await collect(
      fresh,
      envelope([event()], "vtk_ffffffffffffffffffffffffffffffff"),
    )

    expect(revoked).toEqual(unknown)
  })

  it("answers a paused site exactly like an unknown key", async () => {
    client.pausedSites.add(SITE_A)
    const result = await collect(client, envelope([event()]))
    expect(result.status).toBe(404)
  })

  it("rejects a malformed site key", async () => {
    const result = await collect(client, envelope([event()], "not-a-key"))
    expect(result.status).toBe(404)
  })

  it("rejects malformed JSON", async () => {
    const req = request({})
    const result = await handleCollectRequest({
      client: client as unknown as SupabaseClient<Database>,
      request: req,
      rawBodyText: "{ not json",
      now: NOW,
    })

    expect(result.status).toBe(400)
    expect(client.stored).toHaveLength(0)
  })

  it("rejects a backend-only event type and stores nothing", async () => {
    const result = await collect(
      client,
      envelope([event({ eventType: "lead_created" })]),
    )

    expect(result.status).toBe(400)
    expect(client.stored).toHaveLength(0)
  })

  it("rejects the whole request when any event carries a PII field", async () => {
    const result = await collect(
      client,
      envelope([
        event(),
        event({ eventId: "evt_2222222222222222", email: PII_EMAIL }),
      ]),
    )

    expect(result.status).toBe(400)
    expect(client.stored).toHaveLength(0)
    expect(client.recordedText()).not.toContain(PII_EMAIL)
  })

  it("rejects an oversized batch", async () => {
    const events = Array.from({ length: 21 }, (_, index) =>
      event({ eventId: `evt_${String(index).padStart(16, "0")}` }),
    )
    expect((await collect(client, envelope(events))).status).toBe(400)
  })

  it("rejects an empty batch", async () => {
    expect((await collect(client, envelope([]))).status).toBe(400)
  })

  it("refuses the request when a quota is exceeded far past its limit", async () => {
    client.floodQuota = true
    const result = await collect(client, envelope([event()]))

    expect(result.status).toBe(429)
    expect(client.stored).toHaveLength(0)
  })

  it("never writes a raw IP", async () => {
    await collect(client, envelope([event()]))
    expect(client.recordedText()).not.toContain(RAW_IP_SENTINEL)
  })

  it("never writes page query parameters or PII sentinels", async () => {
    await collect(
      client,
      envelope([
        event({
          page: {
            url: `https://example.com/form?email=${PII_EMAIL}&phone=${encodeURIComponent(PII_PHONE)}&note=${PII_MESSAGE}`,
            referrer: `https://example.com/prev?message=${PII_MESSAGE}`,
          },
        }),
      ]),
    )

    const recorded = client.recordedText()
    expect(recorded).not.toContain(PII_EMAIL)
    expect(recorded).not.toContain(PII_MESSAGE)
    expect(recorded).not.toContain("905551234567")

    const call = client.rpcCalls.find(
      (c) => c.name === "ingest_interaction_event",
    )
    expect(call?.args.in_page_path).toBe("/form")
    expect(call?.args.in_page_host).toBe("example.com")
  })

  it("never forwards a whatsapp or tel target", async () => {
    await collect(
      client,
      envelope([
        event({
          eventType: "phone_clicked",
          page: { url: `tel:${PII_PHONE}`, referrer: null },
        }),
      ]),
    )

    const recorded = client.recordedText()
    expect(recorded).not.toContain("905551234567")
    const call = client.rpcCalls.find(
      (c) => c.name === "ingest_interaction_event",
    )
    expect(call?.args.in_page_host).toBeNull()
  })

  it("keeps one site's quota separate from another's", async () => {
    await collect(client, envelope([event()]))
    await collect(client, envelope([event()], OTHER_SITE_KEY), {
      origin: "https://other.example.com",
    })

    expect(client.quotaCounts.get(`site:${SITE_A}`)).toBe(1)
    expect(client.quotaCounts.get(`site:${SITE_B}`)).toBe(1)
  })

  it("records tracker last-seen once per request, not per event", async () => {
    const events = Array.from({ length: 5 }, (_, index) =>
      event({ eventId: `evt_${String(index).padStart(16, "0")}` }),
    )
    await collect(client, envelope(events))

    const touches = client.rpcCalls.filter(
      (c) => c.name === "touch_site_tracker_deployment",
    )
    expect(touches).toHaveLength(1)
  })
})

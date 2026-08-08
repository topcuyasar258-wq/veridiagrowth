import { describe, expect, it } from "vitest"

describe("delivery idempotency model", () => {
  it("does not call provider again after logical delivery is sent", async () => {
    const providerCalls: string[] = []
    const operation = { status: "pending" }

    async function execute(logicalDeliveryKey: string) {
      if (operation.status === "sent") {
        return "skipped"
      }

      providerCalls.push(logicalDeliveryKey)
      operation.status = "sent"
      return "sent"
    }

    const results = await Promise.all(
      Array.from({ length: 20 }, () => execute("notify-business:lead-1")),
    )

    expect(results.filter((result) => result === "sent")).toHaveLength(1)
    expect(providerCalls).toEqual(["notify-business:lead-1"])
  })
})

export type RawBodyResult =
  | { ok: true; rawBody: Uint8Array; text: string }
  | { ok: false; code: "body_too_large" | "body_read_failed" }

export async function readLimitedRawBody(
  request: Request,
  limitBytes: number,
): Promise<RawBodyResult> {
  try {
    const reader = request.body?.getReader()

    if (!reader) {
      return { ok: true, rawBody: new Uint8Array(), text: "" }
    }

    const chunks: Uint8Array[] = []
    let total = 0

    while (true) {
      const { done, value } = await reader.read()

      if (done) {
        break
      }

      total += value.byteLength

      if (total > limitBytes) {
        return { ok: false, code: "body_too_large" }
      }

      chunks.push(value)
    }

    const rawBody = new Uint8Array(total)
    let offset = 0

    for (const chunk of chunks) {
      rawBody.set(chunk, offset)
      offset += chunk.byteLength
    }

    return { ok: true, rawBody, text: new TextDecoder().decode(rawBody) }
  } catch {
    return { ok: false, code: "body_read_failed" }
  }
}

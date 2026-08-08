export function normalizeDomain(input: string): string {
  const normalized = input
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/[:/?#].*$/, "")

  if (!normalized) {
    throw new Error("Domain cannot be normalized.")
  }

  return normalized
}

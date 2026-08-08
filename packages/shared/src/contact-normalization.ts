export function normalizeTurkishPhone(input: string): string | null {
  const digits = input.replace(/\D/g, "")

  if (/^0?5\d{9}$/.test(digits)) {
    const national = digits.startsWith("0") ? digits.slice(1) : digits
    return `+90${national}`
  }

  if (/^905\d{9}$/.test(digits)) {
    return `+${digits}`
  }

  if (/^00905\d{9}$/.test(digits)) {
    return `+${digits.slice(2)}`
  }

  return null
}

export function normalizeEmail(input: string): string | null {
  const trimmed = input.trim()
  const match = /^([^@\s]+)@([^@\s]+\.[^@\s]+)$/.exec(trimmed)

  if (!match) {
    return null
  }

  return `${match[1]}@${match[2].toLowerCase()}`
}

export type BusinessLeadEmailInput = {
  siteName: string
  leadPanelUrl: string
  contact: {
    firstName?: string | null
    lastName?: string | null
    phone?: string | null
    email?: string | null
  }
  lead: {
    service?: string | null
    city?: string | null
    message?: string | null
    createdAt: string
  }
  sourceCategory: string
}

export function renderBusinessLeadEmail(input: BusinessLeadEmailInput) {
  const subject = `Yeni Web Sitesi Talebi - ${input.siteName}`
  const message = truncate(input.lead.message ?? "", 2000)
  const fullName = [input.contact.firstName, input.contact.lastName]
    .filter(Boolean)
    .join(" ")
  const rows = [
    ["Ad Soyad", fullName || "-"],
    ["Telefon", input.contact.phone ?? "-"],
    ["E-posta", input.contact.email ?? "-"],
    ["Hizmet", input.lead.service ?? "-"],
    ["Sehir", input.lead.city ?? "-"],
    ["Mesaj", message || "-"],
    ["Kaynak", input.sourceCategory],
    ["Talep zamani", input.lead.createdAt],
    ["Panel", input.leadPanelUrl],
  ]

  const text = [
    "Yeni musteri talebi alindi.",
    "",
    ...rows.map(([label, value]) => `${label}: ${value}`),
  ].join("\n")

  const htmlRows = rows
    .map(
      ([label, value]) =>
        `<p><strong>${escapeHtml(label)}:</strong> ${escapeHtml(value)}</p>`,
    )
    .join("")

  return {
    subject,
    text,
    html: `<p>Yeni musteri talebi alindi.</p>${htmlRows}`,
  }
}

export function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;")
}

export function truncate(value: string, maxLength: number) {
  return value.length > maxLength ? `${value.slice(0, maxLength)}...` : value
}

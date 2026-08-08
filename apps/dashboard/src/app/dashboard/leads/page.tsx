import Link from "next/link"

import {
  assigneeLabel,
  displayLeadName,
  formatRelativeDate,
  leadStatusLabels,
  parseLeadFilters,
  sourceCategoryLabels,
} from "@/server/leads/format"
import {
  getDashboardContext,
  listCustomerLeads,
} from "@/server/leads/repository"
import type { LeadStatus, SourceCategory } from "@/server/leads/types"

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

const statuses: LeadStatus[] = ["new", "contacted", "offer_sent", "won", "lost"]

const sources: SourceCategory[] = [
  "organic",
  "paid_search",
  "paid_social",
  "referral",
  "direct",
  "unknown",
]

function pageHref(page: number, filters: URLSearchParams) {
  const next = new URLSearchParams(filters)
  next.set("page", String(page))
  return `/dashboard/leads?${next.toString()}`
}

export default async function LeadsPage({ searchParams }: PageProps) {
  const resolvedSearchParams = await searchParams
  const filters = parseLeadFilters(resolvedSearchParams)
  const context = await getDashboardContext()
  const result = await listCustomerLeads(filters)
  const currentParams = new URLSearchParams()

  Object.entries(resolvedSearchParams).forEach(([key, value]) => {
    if (typeof value === "string" && value) {
      currentParams.set(key, value)
    }
  })

  const hasNextPage = result.page * result.pageSize < result.total

  return (
    <main className="shell wide">
      <div className="page-heading">
        <div>
          <p className="eyebrow">{context.organizationName}</p>
          <h1>Talepler</h1>
        </div>
        <Link className="button secondary" href="/dashboard">
          Genel Bakış
        </Link>
      </div>

      <form className="filters" action="/dashboard/leads">
        <label>
          Ara
          <input
            name="q"
            defaultValue={filters.query}
            minLength={2}
            placeholder="Ad, telefon, e-posta, hizmet, şehir"
          />
        </label>
        <label>
          Durum
          <select name="status" defaultValue={filters.status}>
            <option value="all">Tümü</option>
            {statuses.map((status) => (
              <option key={status} value={status}>
                {leadStatusLabels[status]}
              </option>
            ))}
          </select>
        </label>
        <label>
          Kaynak
          <select name="source" defaultValue={filters.source}>
            <option value="all">Tümü</option>
            {sources.map((source) => (
              <option key={source} value={source}>
                {sourceCategoryLabels[source]}
              </option>
            ))}
          </select>
        </label>
        <label>
          Atanan
          <select name="assignee" defaultValue={filters.assignee}>
            <option value="all">Tümü</option>
            <option value="unassigned">Atanmamış</option>
            {context.members.map((member) => (
              <option key={member.userId} value={member.userId}>
                {member.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Site
          <select name="site" defaultValue={filters.siteId}>
            <option value="all">Tümü</option>
            {context.sites.map((site) => (
              <option key={site.id} value={site.id}>
                {site.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Tarih
          <select name="date" defaultValue={filters.date}>
            <option value="all">Tümü</option>
            <option value="today">Bugün</option>
            <option value="7d">Son 7 gün</option>
            <option value="30d">Son 30 gün</option>
          </select>
        </label>
        <button type="submit">Filtrele</button>
      </form>

      <section className="panel list-panel" aria-label="Talep listesi">
        {result.leads.length > 0 ? (
          <div className="lead-list">
            {result.leads.map((lead) => (
              <Link
                className="lead-row"
                href={`/dashboard/leads/${lead.id}`}
                key={lead.id}
              >
                <div>
                  <div className="row-title">
                    <strong>{displayLeadName(lead)}</strong>
                    <span className={`status-badge status-${lead.status}`}>
                      {leadStatusLabels[lead.status as LeadStatus]}
                    </span>
                  </div>
                  <p className="muted compact">
                    {lead.service || "Hizmet belirtilmedi"}
                    {lead.city ? ` · ${lead.city}` : ""}
                  </p>
                  <p className="muted compact">
                    {
                      sourceCategoryLabels[
                        lead.source_category as SourceCategory
                      ]
                    }{" "}
                    · {formatRelativeDate(lead.created_at)} ·{" "}
                    {assigneeLabel(
                      lead.assigned_to,
                      context.members,
                      context.userId,
                    )}
                  </p>
                </div>
                <div className="row-actions">
                  {lead.is_duplicate ? (
                    <span className="signal duplicate">Benzer Talep</span>
                  ) : null}
                  {lead.is_suspicious ? (
                    <span className="signal suspicious">İncelenmeli</span>
                  ) : null}
                </div>
              </Link>
            ))}
          </div>
        ) : (
          <div className="empty-state">
            <h2>Talep bulunamadı</h2>
            <p className="muted">
              Filtreleri değiştirerek veya yeni form gönderimi yaparak tekrar
              kontrol edin.
            </p>
          </div>
        )}
      </section>

      <nav className="pagination" aria-label="Sayfalama">
        {filters.page > 1 ? (
          <a href={pageHref(filters.page - 1, currentParams)}>Önceki</a>
        ) : (
          <span className="muted">Önceki</span>
        )}
        <span>
          Sayfa {filters.page} · {result.total} talep
        </span>
        {hasNextPage ? (
          <a href={pageHref(filters.page + 1, currentParams)}>Sonraki</a>
        ) : (
          <span className="muted">Sonraki</span>
        )}
      </nav>
    </main>
  )
}

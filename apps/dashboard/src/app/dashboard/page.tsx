import Link from "next/link"

import {
  getDashboardContext,
  getDashboardCounts,
} from "@/server/leads/repository"

export default async function DashboardPage() {
  const context = await getDashboardContext()
  const counts = await getDashboardCounts()

  return (
    <main className="shell wide">
      <div className="page-heading">
        <div>
          <p className="eyebrow">{context.organizationName}</p>
          <h1>Genel Bakış</h1>
        </div>
        <Link className="button" href="/dashboard/leads">
          Talepleri Aç
        </Link>
      </div>

      <section className="metrics-grid" aria-label="Talep özeti">
        <article className="metric">
          <span>Toplam Talep</span>
          <strong>{counts.total}</strong>
        </article>
        <article className="metric">
          <span>Yeni</span>
          <strong>{counts.newCount}</strong>
        </article>
        <article className="metric">
          <span>İletişime Geçildi</span>
          <strong>{counts.contactedCount}</strong>
        </article>
        <article className="metric">
          <span>İncelenmeli</span>
          <strong>{counts.suspiciousCount}</strong>
        </article>
      </section>

      <section className="panel stack">
        <h2>Çalışma Alanı</h2>
        <p className="muted">
          Talepleri listeleyin, durumunu değiştirin, not ekleyin ve personel
          atamasını yönetin.
        </p>
        <div className="action-row">
          <Link className="button" href="/dashboard/leads">
            Talepler
          </Link>
          <Link className="button secondary" href="/dashboard/sites">
            Siteler
          </Link>
        </div>
      </section>
    </main>
  )
}

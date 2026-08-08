import Link from "next/link"

export default function LeadNotFound() {
  return (
    <main className="shell">
      <section className="panel empty-state">
        <h1>Talep bulunamadı</h1>
        <p className="muted">
          Bu talep silinmiş olabilir veya bu organizasyonda görünür değildir.
        </p>
        <Link className="button" href="/dashboard/leads">
          Taleplere Dön
        </Link>
      </section>
    </main>
  )
}

export default function LeadDetailLoading() {
  return (
    <main className="shell wide">
      <div className="page-heading">
        <div>
          <p className="eyebrow">Yükleniyor</p>
          <h1>Talep</h1>
        </div>
      </div>
      <div className="detail-grid">
        <section className="panel stack">
          <div className="skeleton" />
          <div className="skeleton" />
        </section>
        <section className="panel stack">
          <div className="skeleton" />
        </section>
      </div>
    </main>
  )
}

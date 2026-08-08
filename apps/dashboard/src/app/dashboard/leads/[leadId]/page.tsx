import Link from "next/link"
import { notFound } from "next/navigation"

import {
  assigneeLabel,
  buildTelHref,
  buildWhatsAppHref,
  displayLeadName,
  formatRelativeDate,
  leadStatusLabels,
  sourceCategoryLabels,
} from "@/server/leads/format"
import { getLeadDetail } from "@/server/leads/repository"
import type { LeadStatus, SourceCategory } from "@/server/leads/types"

import { LeadAssignmentForm, LeadNoteForm, LeadStatusForm } from "../lead-forms"

type PageProps = {
  params: Promise<{ leadId: string }>
}

function Field({
  label,
  value,
}: {
  label: string
  value: string | null | undefined
}) {
  return (
    <div className="field">
      <span>{label}</span>
      <strong>{value?.trim() || "Belirtilmedi"}</strong>
    </div>
  )
}

export default async function LeadDetailPage({ params }: PageProps) {
  const { leadId } = await params

  if (!/^[0-9a-f-]{36}$/i.test(leadId)) {
    notFound()
  }

  const { context, lead } = await getLeadDetail(leadId)
  const telHref = buildTelHref(lead.phone_normalized)
  const whatsappHref = buildWhatsAppHref(
    lead.phone_normalized,
    `Merhaba ${displayLeadName(lead)}, talebinizle ilgili size ulaşıyorum.`,
  )

  return (
    <main className="shell wide">
      <div className="page-heading">
        <div>
          <Link className="back-link" href="/dashboard/leads">
            Talepler
          </Link>
          <h1>{displayLeadName(lead)}</h1>
          <p className="muted">
            {lead.siteName} · {formatRelativeDate(lead.created_at)}
          </p>
        </div>
        <span className={`status-badge status-${lead.status}`}>
          {leadStatusLabels[lead.status as LeadStatus]}
        </span>
      </div>

      <div className="detail-grid">
        <section className="panel stack">
          <div className="section-heading">
            <h2>Talep Bilgileri</h2>
            <div className="row-actions">
              {lead.is_duplicate ? (
                <span className="signal duplicate">Benzer Talep</span>
              ) : null}
              {lead.is_suspicious ? (
                <span className="signal suspicious">İncelenmeli</span>
              ) : null}
            </div>
          </div>
          <div className="fields">
            <Field label="Telefon" value={lead.phone} />
            <Field label="E-posta" value={lead.email} />
            <Field label="Hizmet" value={lead.service} />
            <Field label="Şehir" value={lead.city} />
            <Field
              label="Kaynak"
              value={
                sourceCategoryLabels[lead.source_category as SourceCategory] ??
                "Bilinmiyor"
              }
            />
            <Field
              label="Atanan Kişi"
              value={assigneeLabel(
                lead.assigned_to,
                context.members,
                context.userId,
              )}
            />
          </div>
          {lead.message ? <p className="message-box">{lead.message}</p> : null}
          <div className="action-row">
            {telHref ? (
              <a className="button secondary" href={telHref}>
                Ara
              </a>
            ) : null}
            {whatsappHref ? (
              <a
                className="button secondary"
                href={whatsappHref}
                rel="noreferrer"
                target="_blank"
              >
                WhatsApp&apos;tan Yaz
              </a>
            ) : null}
          </div>
        </section>

        <aside className="panel stack">
          <h2>Durum ve Atama</h2>
          <LeadStatusForm
            leadId={lead.id}
            version={lead.version}
            currentStatus={lead.status as LeadStatus}
            role={context.role}
          />
          <LeadAssignmentForm
            leadId={lead.id}
            version={lead.version}
            role={context.role}
            members={context.members}
            currentUserId={context.userId}
            assignedTo={lead.assigned_to}
          />
        </aside>

        <section className="panel stack">
          <h2>Kaynak Detayı</h2>
          <div className="fields">
            <Field
              label="Landing Page"
              value={lead.attribution?.landing_page}
            />
            <Field
              label="Conversion Page"
              value={lead.attribution?.conversion_page}
            />
            <Field label="Referrer" value={lead.attribution?.referrer} />
            <Field label="UTM Source" value={lead.attribution?.utm_source} />
            <Field label="UTM Medium" value={lead.attribution?.utm_medium} />
            <Field
              label="UTM Campaign"
              value={lead.attribution?.utm_campaign}
            />
          </div>
        </section>

        <section className="panel stack">
          <h2>Notlar</h2>
          <LeadNoteForm leadId={lead.id} role={context.role} />
          {lead.notes.length > 0 ? (
            <div className="timeline">
              {lead.notes.map((note) => (
                <article key={note.id} className="timeline-item">
                  <p>{note.body}</p>
                  <span className="muted">
                    {formatRelativeDate(note.created_at)}
                  </span>
                </article>
              ))}
            </div>
          ) : (
            <p className="muted">Henüz not yok.</p>
          )}
        </section>

        <section className="panel stack">
          <h2>Durum Geçmişi</h2>
          {lead.history.length > 0 ? (
            <div className="timeline">
              {lead.history.map((item) => (
                <article key={item.id} className="timeline-item">
                  <strong>
                    {item.old_status
                      ? `${leadStatusLabels[item.old_status as LeadStatus]} → `
                      : ""}
                    {leadStatusLabels[item.new_status as LeadStatus]}
                  </strong>
                  {item.note ? <p>{item.note}</p> : null}
                  <span className="muted">
                    {item.actor_type === "system" ? "Sistem" : "Kullanıcı"} ·{" "}
                    {formatRelativeDate(item.created_at)}
                  </span>
                </article>
              ))}
            </div>
          ) : (
            <p className="muted">Durum geçmişi henüz oluşmadı.</p>
          )}
        </section>
      </div>
    </main>
  )
}

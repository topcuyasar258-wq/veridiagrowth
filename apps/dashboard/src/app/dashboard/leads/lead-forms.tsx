"use client"

import { useActionState } from "react"

import {
  addLeadNoteAction,
  assignLeadAction,
  updateLeadStatusAction,
} from "./actions"
import {
  canAssignMember,
  canMutateLead,
  leadStatusLabels,
} from "@/server/leads/format"
import type {
  DashboardMember,
  LeadActionState,
  LeadStatus,
  MemberRole,
} from "@/server/leads/types"

const emptyState: LeadActionState = { ok: false, message: "" }

const statuses: LeadStatus[] = ["new", "contacted", "offer_sent", "won", "lost"]

function FormMessage({ state }: { state: LeadActionState }) {
  if (!state.message) {
    return null
  }

  return (
    <p className={state.ok ? "form-message success" : "form-message error"}>
      {state.message}
    </p>
  )
}

export function LeadStatusForm({
  leadId,
  version,
  currentStatus,
  role,
}: {
  leadId: string
  version: number
  currentStatus: LeadStatus
  role: MemberRole
}) {
  const [state, formAction, pending] = useActionState(
    updateLeadStatusAction,
    emptyState,
  )

  if (!canMutateLead(role)) {
    return <p className="muted">Bu talebin durumunu değiştirme yetkiniz yok.</p>
  }

  return (
    <form className="stack" action={formAction}>
      <input type="hidden" name="leadId" value={leadId} />
      <input type="hidden" name="version" value={version} />
      <label>
        Durum
        <select name="status" defaultValue={currentStatus}>
          {statuses.map((status) => (
            <option key={status} value={status}>
              {leadStatusLabels[status]}
            </option>
          ))}
        </select>
      </label>
      <label>
        Durum notu
        <textarea
          name="note"
          maxLength={2000}
          rows={3}
          placeholder="Kısa bir durum notu"
        />
      </label>
      <button type="submit" disabled={pending}>
        {pending ? "Kaydediliyor" : "Durumu Güncelle"}
      </button>
      <FormMessage state={state} />
    </form>
  )
}

export function LeadNoteForm({
  leadId,
  role,
}: {
  leadId: string
  role: MemberRole
}) {
  const [state, formAction, pending] = useActionState(
    addLeadNoteAction,
    emptyState,
  )

  if (!canMutateLead(role)) {
    return <p className="muted">Not ekleme yetkiniz yok.</p>
  }

  return (
    <form className="stack" action={formAction}>
      <input type="hidden" name="leadId" value={leadId} />
      <label>
        Yeni not
        <textarea
          name="body"
          maxLength={5000}
          rows={4}
          placeholder="Görüşme notu"
          required
        />
      </label>
      <button type="submit" disabled={pending}>
        {pending ? "Ekleniyor" : "Not Ekle"}
      </button>
      <FormMessage state={state} />
    </form>
  )
}

export function LeadAssignmentForm({
  leadId,
  version,
  role,
  members,
  currentUserId,
  assignedTo,
}: {
  leadId: string
  version: number
  role: MemberRole
  members: DashboardMember[]
  currentUserId: string
  assignedTo: string | null
}) {
  const [state, formAction, pending] = useActionState(
    assignLeadAction,
    emptyState,
  )
  const assignableMembers = members.filter((member) =>
    canAssignMember(role, member, currentUserId),
  )

  if (assignableMembers.length === 0) {
    return <p className="muted">Atama değiştirme yetkiniz yok.</p>
  }

  return (
    <form className="inline-form" action={formAction}>
      <input type="hidden" name="leadId" value={leadId} />
      <input type="hidden" name="version" value={version} />
      <label>
        Atanan Kişi
        <select name="assignee" defaultValue={assignedTo ?? "unassigned"}>
          {role === "organization_owner" ? (
            <option value="unassigned">Atanmamış</option>
          ) : null}
          {assignableMembers.map((member) => (
            <option key={member.userId} value={member.userId}>
              {member.label}
            </option>
          ))}
        </select>
      </label>
      <button type="submit" disabled={pending}>
        {pending ? "Kaydediliyor" : "Ata"}
      </button>
      <FormMessage state={state} />
    </form>
  )
}

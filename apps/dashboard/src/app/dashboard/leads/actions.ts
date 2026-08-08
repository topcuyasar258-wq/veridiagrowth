"use server"

import { revalidatePath } from "next/cache"

import {
  addLeadNote,
  assignLead,
  errorState,
  successState,
  updateLeadStatus,
} from "@/server/leads/repository"
import type { LeadActionState, LeadStatus } from "@/server/leads/types"

const staleMessage =
  "Bu talep başka bir kullanıcı tarafından güncellendi. En güncel halini tekrar yükleyin."

const allowedStatuses = new Set<LeadStatus>([
  "new",
  "contacted",
  "offer_sent",
  "won",
  "lost",
])

const initialError = "İşlem tamamlanamadı. Lütfen tekrar deneyin."

function stringValue(formData: FormData, key: string) {
  const value = formData.get(key)
  return typeof value === "string" ? value.trim() : ""
}

function parseVersion(formData: FormData) {
  const version = Number.parseInt(stringValue(formData, "version"), 10)
  return Number.isFinite(version) && version > 0 ? version : null
}

function mapMutationError(error: { code?: string; message?: string } | null) {
  if (error?.code === "40001") {
    return errorState(staleMessage, true)
  }

  if (error?.code === "02000") {
    return errorState("Talep bulunamadı.")
  }

  if (error?.code === "42501") {
    return errorState("Bu işlem için yetkiniz yok.")
  }

  if (error?.code === "22023") {
    return errorState("Gönderilen bilgi geçerli değil.")
  }

  return errorState(initialError)
}

export async function updateLeadStatusAction(
  _previousState: LeadActionState,
  formData: FormData,
): Promise<LeadActionState> {
  const leadId = stringValue(formData, "leadId")
  const status = stringValue(formData, "status") as LeadStatus
  const note = stringValue(formData, "note")
  const version = parseVersion(formData)

  if (!leadId || !version || !allowedStatuses.has(status)) {
    return errorState("Durum güncellemesi geçerli değil.")
  }

  const { error } = await updateLeadStatus(
    leadId,
    version,
    status,
    note || null,
  )

  if (error) {
    return mapMutationError(error)
  }

  revalidatePath(`/dashboard/leads/${leadId}`)
  revalidatePath("/dashboard/leads")
  revalidatePath("/dashboard")
  return successState("Durum güncellendi.")
}

export async function addLeadNoteAction(
  _previousState: LeadActionState,
  formData: FormData,
): Promise<LeadActionState> {
  const leadId = stringValue(formData, "leadId")
  const body = stringValue(formData, "body")

  if (!leadId || body.length === 0 || body.length > 5000) {
    return errorState("Not 1-5000 karakter arasında olmalı.")
  }

  const { error } = await addLeadNote(leadId, body)

  if (error) {
    return mapMutationError(error)
  }

  revalidatePath(`/dashboard/leads/${leadId}`)
  revalidatePath("/dashboard/leads")
  revalidatePath("/dashboard")
  return successState("Not eklendi.")
}

export async function assignLeadAction(
  _previousState: LeadActionState,
  formData: FormData,
): Promise<LeadActionState> {
  const leadId = stringValue(formData, "leadId")
  const assignee = stringValue(formData, "assignee")
  const version = parseVersion(formData)
  const assigneeUserId = assignee === "unassigned" ? null : assignee

  if (!leadId || !version) {
    return errorState("Atama bilgisi geçerli değil.")
  }

  const { error } = await assignLead(leadId, version, assigneeUserId)

  if (error) {
    return mapMutationError(error)
  }

  revalidatePath(`/dashboard/leads/${leadId}`)
  revalidatePath("/dashboard/leads")
  revalidatePath("/dashboard")
  return successState("Atanan kişi güncellendi.")
}

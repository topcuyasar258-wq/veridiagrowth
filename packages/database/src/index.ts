export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

type Table<Row, Insert, Update = Partial<Insert>> = {
  Row: Row
  Insert: Insert
  Update: Update
  Relationships: []
}

export interface Database {
  public: {
    Tables: {
      organizations: Table<
        {
          id: string
          name: string
          slug: string
          status: string
          created_at: string
          updated_at: string
        },
        {
          id?: string
          name: string
          slug: string
          status?: string
          created_at?: string
          updated_at?: string
        }
      >
      organization_members: Table<
        {
          id: string
          organization_id: string
          user_id: string
          role: string
          created_at: string
          updated_at: string
        },
        {
          id?: string
          organization_id: string
          user_id: string
          role: string
          created_at?: string
          updated_at?: string
        }
      >
      sites: Table<
        {
          id: string
          organization_id: string
          name: string
          status: string
          created_at: string
          updated_at: string
        },
        {
          id?: string
          organization_id: string
          name: string
          status?: string
          created_at?: string
          updated_at?: string
        }
      >
      site_domains: Table<
        {
          id: string
          site_id: string
          domain: string
          normalized_domain: string
          status: string
          is_primary: boolean
          verified_at: string | null
          deleted_at: string | null
          created_at: string
        },
        {
          id?: string
          site_id: string
          domain: string
          normalized_domain: string
          status?: string
          is_primary?: boolean
          verified_at?: string | null
          deleted_at?: string | null
          created_at?: string
        }
      >
      audit_logs: Table<
        {
          id: string
          organization_id: string | null
          actor_user_id: string | null
          action: string
          entity_type: string
          entity_id: string | null
          metadata: Json
          created_at: string
        },
        {
          id?: string
          organization_id?: string | null
          actor_user_id?: string | null
          action: string
          entity_type: string
          entity_id?: string | null
          metadata?: Json
          created_at?: string
        }
      >
      leads: Table<
        {
          id: string
          organization_id: string
          site_id: string
          first_name: string | null
          last_name: string | null
          phone: string | null
          phone_normalized: string | null
          email: string | null
          email_normalized: string | null
          service: string | null
          city: string | null
          message: string | null
          status: string
          assigned_to: string | null
          is_duplicate: boolean
          duplicate_of: string | null
          is_suspicious: boolean
          suspicion_reasons: string[]
          source_category: string
          version: number
          last_activity_at: string
          created_at: string
          updated_at: string
          deleted_at: string | null
        },
        {
          id?: string
          organization_id: string
          site_id: string
          first_name?: string | null
          last_name?: string | null
          phone?: string | null
          phone_normalized?: string | null
          email?: string | null
          email_normalized?: string | null
          service?: string | null
          city?: string | null
          message?: string | null
          status?: string
          assigned_to?: string | null
          is_duplicate?: boolean
          duplicate_of?: string | null
          is_suspicious?: boolean
          suspicion_reasons?: string[]
          source_category?: string
          version?: number
          last_activity_at?: string
          created_at?: string
          updated_at?: string
          deleted_at?: string | null
        }
      >
      lead_attributions: Table<
        {
          id: string
          lead_id: string
          organization_id: string
          site_id: string
          landing_page: string | null
          conversion_page: string | null
          referrer: string | null
          utm_source: string | null
          utm_medium: string | null
          utm_campaign: string | null
          utm_content: string | null
          utm_term: string | null
          first_touch_source: string | null
          first_touch_medium: string | null
          first_touch_campaign: string | null
          first_touch_referrer: string | null
          first_touch_at: string | null
          last_touch_source: string | null
          last_touch_medium: string | null
          last_touch_campaign: string | null
          last_touch_referrer: string | null
          last_touch_at: string | null
          source_category: string
          attribution_window_days: number
          created_at: string
          updated_at: string
        },
        {
          id?: string
          lead_id: string
          organization_id: string
          site_id: string
          landing_page?: string | null
          conversion_page?: string | null
          referrer?: string | null
          utm_source?: string | null
          utm_medium?: string | null
          utm_campaign?: string | null
          utm_content?: string | null
          utm_term?: string | null
          first_touch_source?: string | null
          first_touch_medium?: string | null
          first_touch_campaign?: string | null
          first_touch_referrer?: string | null
          first_touch_at?: string | null
          last_touch_source?: string | null
          last_touch_medium?: string | null
          last_touch_campaign?: string | null
          last_touch_referrer?: string | null
          last_touch_at?: string | null
          source_category?: string
          attribution_window_days?: number
          created_at?: string
          updated_at?: string
        }
      >
      lead_status_history: Table<
        {
          id: string
          organization_id: string
          lead_id: string
          old_status: string | null
          new_status: string
          actor_user_id: string | null
          actor_type: string
          assigned_to: string | null
          note: string | null
          created_at: string
        },
        {
          id?: string
          organization_id: string
          lead_id: string
          old_status?: string | null
          new_status: string
          actor_user_id?: string | null
          actor_type?: string
          assigned_to?: string | null
          note?: string | null
          created_at?: string
        }
      >
      lead_notes: Table<
        {
          id: string
          organization_id: string
          lead_id: string
          author_user_id: string
          body: string
          created_at: string
          updated_at: string | null
          deleted_at: string | null
        },
        {
          id?: string
          organization_id: string
          lead_id: string
          author_user_id: string
          body: string
          created_at?: string
          updated_at?: string | null
          deleted_at?: string | null
        }
      >
      site_credentials: Table<
        {
          id: string
          site_id: string
          organization_id: string
          key_id: string
          secret_ciphertext: string
          secret_fingerprint: string
          status: "active" | "rotating" | "revoked" | "expired"
          valid_from: string
          valid_until: string | null
          rotation_group_id: string | null
          created_by: string
          revoked_by: string | null
          revoked_at: string | null
          created_at: string
          updated_at: string
        },
        {
          id?: string
          site_id: string
          organization_id: string
          key_id: string
          secret_ciphertext: string
          secret_fingerprint: string
          status: "active" | "rotating" | "revoked" | "expired"
          valid_from?: string
          valid_until?: string | null
          rotation_group_id?: string | null
          created_by: string
          revoked_by?: string | null
          revoked_at?: string | null
          created_at?: string
          updated_at?: string
        }
      >
      used_nonces: Table<
        {
          id: string
          site_id: string
          credential_id: string
          nonce_hash: string
          request_timestamp: string
          expires_at: string
          created_at: string
        },
        {
          id?: string
          site_id: string
          credential_id: string
          nonce_hash: string
          request_timestamp: string
          expires_at: string
          created_at?: string
        }
      >
      idempotency_records: Table<
        {
          id: string
          site_id: string
          idempotency_key_hash: string
          request_hash: string
          status: "processing" | "completed" | "failed"
          resource_type: string | null
          resource_id: string | null
          response_status: number | null
          response_body: Json | null
          locked_until: string | null
          expires_at: string
          failure_kind: string | null
          error_code: string | null
          created_at: string
          updated_at: string
        },
        {
          id?: string
          site_id: string
          idempotency_key_hash: string
          request_hash: string
          status: "processing" | "completed" | "failed"
          resource_type?: string | null
          resource_id?: string | null
          response_status?: number | null
          response_body?: Json | null
          locked_until?: string | null
          expires_at: string
          failure_kind?: string | null
          error_code?: string | null
          created_at?: string
          updated_at?: string
        }
      >
      outbox_events: Table<
        {
          id: string
          organization_id: string
          site_id: string | null
          event_type: string
          aggregate_type: string
          aggregate_id: string
          job_key: string
          payload: Json
          status: string
          available_at: string
          attempt_count: number
          locked_at: string | null
          locked_by: string | null
          last_worker_id: string | null
          last_error_code: string | null
          last_error_at: string | null
          created_at: string
          processed_at: string | null
        },
        {
          id?: string
          organization_id: string
          site_id?: string | null
          event_type: string
          aggregate_type: string
          aggregate_id: string
          job_key: string
          payload: Json
          status?: string
          available_at?: string
          attempt_count?: number
          locked_at?: string | null
          locked_by?: string | null
          last_worker_id?: string | null
          last_error_code?: string | null
          last_error_at?: string | null
          created_at?: string
          processed_at?: string | null
        }
      >
      domain_events: Table<
        {
          id: string
          organization_id: string
          site_id: string | null
          event_type: string
          aggregate_type: string
          aggregate_id: string
          payload: Json
          created_at: string
        },
        {
          id?: string
          organization_id: string
          site_id?: string | null
          event_type: string
          aggregate_type: string
          aggregate_id: string
          payload: Json
          created_at?: string
        }
      >
      security_events: Table<
        {
          id: string
          organization_id: string | null
          site_id: string | null
          event_type: string
          severity: string
          metadata: Json
          created_at: string
        },
        {
          id?: string
          organization_id?: string | null
          site_id?: string | null
          event_type: string
          severity?: string
          metadata?: Json
          created_at?: string
        }
      >
      lead_rate_limits: Table<
        {
          id: string
          site_id: string
          scope: string
          bucket_key: string
          window_start: string
          window_seconds: number
          count: number
          created_at: string
          updated_at: string
        },
        {
          id?: string
          site_id: string
          scope: string
          bucket_key: string
          window_start: string
          window_seconds: number
          count?: number
          created_at?: string
          updated_at?: string
        }
      >
      job_executions: Table<
        {
          id: string
          outbox_event_id: string
          organization_id: string
          job_key: string
          event_type: string
          attempt_number: number
          worker_id: string
          status: string
          started_at: string
          finished_at: string | null
          duration_ms: number | null
          error_code: string | null
          error_category: string | null
          error_message_safe: string | null
          created_at: string
        },
        {
          id?: string
          outbox_event_id: string
          organization_id: string
          job_key: string
          event_type: string
          attempt_number: number
          worker_id: string
          status: string
          started_at?: string
          finished_at?: string | null
          duration_ms?: number | null
          error_code?: string | null
          error_category?: string | null
          error_message_safe?: string | null
          created_at?: string
        }
      >
      delivery_operations: Table<
        {
          id: string
          organization_id: string
          site_id: string | null
          lead_id: string | null
          channel: string
          template_key: string
          logical_delivery_key: string
          status: string
          provider_message_id: string | null
          created_at: string
          updated_at: string
        },
        {
          id?: string
          organization_id: string
          site_id?: string | null
          lead_id?: string | null
          channel: string
          template_key: string
          logical_delivery_key: string
          status?: string
          provider_message_id?: string | null
          created_at?: string
          updated_at?: string
        }
      >
      delivery_attempts: Table<
        {
          id: string
          organization_id: string
          site_id: string | null
          lead_id: string | null
          outbox_event_id: string | null
          delivery_operation_id: string | null
          channel: string
          provider: string
          template_key: string
          recipient_fingerprint: string
          attempt_number: number
          status: string
          provider_message_id: string | null
          provider_status: string | null
          error_code: string | null
          error_message_safe: string | null
          sent_at: string | null
          delivered_at: string | null
          failed_at: string | null
          created_at: string
        },
        {
          id?: string
          organization_id: string
          site_id?: string | null
          lead_id?: string | null
          outbox_event_id?: string | null
          delivery_operation_id?: string | null
          channel: string
          provider: string
          template_key: string
          recipient_fingerprint: string
          attempt_number: number
          status: string
          provider_message_id?: string | null
          provider_status?: string | null
          error_code?: string | null
          error_message_safe?: string | null
          sent_at?: string | null
          delivered_at?: string | null
          failed_at?: string | null
          created_at?: string
        }
      >
      dead_letter_events: Table<
        {
          id: string
          outbox_event_id: string
          organization_id: string
          job_key: string
          event_type: string
          final_attempt_count: number
          failure_code: string
          failure_category: string
          failure_message_safe: string | null
          payload_reference: Json
          dead_lettered_at: string
          resolved_at: string | null
          resolved_by: string | null
          resolution_note: string | null
          created_at: string
        },
        {
          id?: string
          outbox_event_id: string
          organization_id: string
          job_key: string
          event_type: string
          final_attempt_count: number
          failure_code: string
          failure_category: string
          failure_message_safe?: string | null
          payload_reference: Json
          dead_lettered_at?: string
          resolved_at?: string | null
          resolved_by?: string | null
          resolution_note?: string | null
          created_at?: string
        }
      >
      notification_settings: Table<
        {
          id: string
          organization_id: string
          site_id: string | null
          channel: string
          recipient_email: string | null
          enabled: boolean
          created_at: string
          updated_at: string
        },
        {
          id?: string
          organization_id: string
          site_id?: string | null
          channel: string
          recipient_email?: string | null
          enabled?: boolean
          created_at?: string
          updated_at?: string
        }
      >
    }
    Views: Record<string, never>
    Functions: {
      claim_lead_rate_limit: {
        Args: {
          target_site_id: string
          rate_scope: string
          target_bucket_key: string
          window_seconds: number
          max_attempts: number
        }
        Returns: Json
      }
      complete_lead_ingestion: {
        Args: {
          idempotency_record_id: string
          target_organization_id: string
          target_site_id: string
          lead_payload: Json
          attribution_payload: Json
          response_payload: Json
        }
        Returns: Json
      }
      record_security_event: {
        Args: {
          target_organization_id: string | null
          target_site_id: string | null
          event_name: string
          event_severity: string
          event_metadata: Json
        }
        Returns: undefined
      }
      claim_outbox_events: {
        Args: {
          worker_id: string
          batch_size: number
          lock_timeout_seconds: number
        }
        Returns: Database["public"]["Tables"]["outbox_events"]["Row"][]
      }
      finish_outbox_success: {
        Args: {
          target_outbox_event_id: string
          target_worker_id: string
        }
        Returns: undefined
      }
      finish_outbox_failure: {
        Args: {
          target_outbox_event_id: string
          target_worker_id: string
          retryable: boolean
          max_attempts: number
          next_available_at: string
          failure_code: string
          failure_category: string
          failure_message_safe: string
        }
        Returns: string
      }
      requeue_dead_letter_event: {
        Args: {
          target_dead_letter_id: string
          actor_user_id: string
        }
        Returns: undefined
      }
      resolve_dead_letter_event: {
        Args: {
          target_dead_letter_id: string
          actor_user_id: string
          note: string
        }
        Returns: undefined
      }
    }
    Enums: Record<string, never>
    CompositeTypes: Record<string, never>
  }
}

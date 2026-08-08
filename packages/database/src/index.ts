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
    }
    Views: Record<string, never>
    Functions: Record<string, never>
    Enums: Record<string, never>
    CompositeTypes: Record<string, never>
  }
}

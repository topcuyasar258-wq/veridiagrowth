import "server-only"

import { createClient } from "@supabase/supabase-js"

import type { Database } from "@veridia/database"
import { serverEnv } from "@/env/server"

export function createSupabaseAdminClient() {
  return createClient<Database>(
    serverEnv.NEXT_PUBLIC_SUPABASE_URL,
    serverEnv.SUPABASE_SERVICE_ROLE_KEY,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    },
  )
}

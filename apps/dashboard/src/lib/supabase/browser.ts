"use client"

import { createBrowserClient } from "@supabase/ssr"

import type { Database } from "@veridia/database"
import { clientEnv } from "@/env/client"

export function createSupabaseBrowserClient() {
  return createBrowserClient<Database>(
    clientEnv.NEXT_PUBLIC_SUPABASE_URL,
    clientEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  )
}

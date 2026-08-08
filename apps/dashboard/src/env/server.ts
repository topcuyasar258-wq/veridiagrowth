import "server-only"

import { z } from "zod"

import { clientEnv } from "./client"

const serverEnvSchema = z.object({
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  SENTRY_AUTH_TOKEN: z.string().min(1).optional(),
})

const parsedServerEnv = serverEnvSchema.safeParse({
  SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
  SENTRY_AUTH_TOKEN: process.env.SENTRY_AUTH_TOKEN,
})

if (!parsedServerEnv.success) {
  throw new Error("Server environment is not configured correctly.")
}

export const serverEnv = {
  ...clientEnv,
  ...parsedServerEnv.data,
}

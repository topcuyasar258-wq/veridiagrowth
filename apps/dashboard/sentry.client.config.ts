import * as Sentry from "@sentry/nextjs"

import { getSentryEnvironment, getSentryDsn } from "./src/lib/sentry"
import { sanitizeSentryEvent } from "../../packages/security/src/sentry"

const dsn = getSentryDsn()

if (dsn) {
  Sentry.init({
    dsn,
    environment: getSentryEnvironment(),
    sendDefaultPii: false,
    tracesSampleRate: 0,
    beforeSend(event) {
      return sanitizeSentryEvent(event)
    },
  })
}

import { z } from "zod"

const isoDateTime = z.string().datetime({ offset: true })
const nullableString = (max: number) =>
  z.string().max(max).nullable().optional()
const limitedString = (max: number) => z.string().trim().max(max)
const optionalLimitedString = (max: number) =>
  z.string().trim().max(max).optional()

export const leadRequestSchema = z
  .object({
    schemaVersion: z.literal("1.0"),
    form: z
      .object({
        formId: limitedString(150).min(1),
        startedAt: isoDateTime,
        submittedAt: isoDateTime,
        honeypot: z.string().max(200).default(""),
      })
      .strict(),
    contact: z
      .object({
        firstName: optionalLimitedString(100),
        lastName: optionalLimitedString(100),
        phone: optionalLimitedString(40),
        email: z.string().trim().email().max(320).optional(),
      })
      .strict()
      .refine((contact) => Boolean(contact.phone || contact.email), {
        message: "At least one contact channel is required.",
      }),
    lead: z
      .object({
        service: optionalLimitedString(150),
        city: optionalLimitedString(150),
        message: optionalLimitedString(5000),
      })
      .strict(),
    attribution: z
      .object({
        landingPage: nullableString(2048),
        conversionPage: nullableString(2048),
        referrer: nullableString(2048),
        utmSource: nullableString(255),
        utmMedium: nullableString(255),
        utmCampaign: nullableString(500),
        utmContent: nullableString(500),
        utmTerm: nullableString(500),
        firstTouch: z
          .object({
            source: nullableString(255),
            medium: nullableString(255),
            campaign: nullableString(500),
            referrer: nullableString(2048),
            occurredAt: isoDateTime.nullable().optional(),
          })
          .strict()
          .nullable()
          .optional(),
        lastTouch: z
          .object({
            source: nullableString(255),
            medium: nullableString(255),
            campaign: nullableString(500),
            referrer: nullableString(2048),
            occurredAt: isoDateTime.nullable().optional(),
          })
          .strict()
          .nullable()
          .optional(),
      })
      .strict(),
    security: z
      .object({
        turnstileToken: z.string().min(1).max(4096),
      })
      .strict(),
  })
  .strict()

export type LeadRequestBody = z.infer<typeof leadRequestSchema>

export function validateLeadRequestBody(input: unknown) {
  return leadRequestSchema.safeParse(input)
}

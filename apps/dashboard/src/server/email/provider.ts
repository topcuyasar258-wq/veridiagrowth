export type SendEmailInput = {
  to: string
  subject: string
  html: string
  text: string
  idempotencyKey: string
}

export type SendEmailResult =
  | {
      success: true
      providerMessageId: string
    }
  | {
      success: false
      retryable: boolean
      code: string
    }

export type EmailProvider = {
  send(input: SendEmailInput): Promise<SendEmailResult>
}

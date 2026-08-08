"use client"

import { useState } from "react"

import { createSupabaseBrowserClient } from "@/lib/supabase/browser"

export function LoginForm() {
  const [email, setEmail] = useState("")
  const [message, setMessage] = useState<string | null>(null)
  const supabase = createSupabaseBrowserClient()

  async function submitLogin(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setMessage(null)

    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: `${window.location.origin}/auth/callback`,
      },
    })

    setMessage(error ? "Login link could not be sent." : "Login link sent.")
  }

  return (
    <form onSubmit={(event) => void submitLogin(event)} className="panel">
      <label>
        Email
        <input
          autoComplete="email"
          name="email"
          onChange={(event) => setEmail(event.target.value)}
          required
          type="email"
          value={email}
        />
      </label>
      <button type="submit">Send login link</button>
      {message ? <p className="muted">{message}</p> : null}
    </form>
  )
}

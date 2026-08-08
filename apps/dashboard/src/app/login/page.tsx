import { LoginForm } from "./login-form"

export default function LoginPage() {
  return (
    <main className="shell">
      <section className="panel">
        <h1>Login</h1>
        <p className="muted">Sign in with Supabase Auth.</p>
        <LoginForm />
      </section>
    </main>
  )
}

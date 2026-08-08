import Link from "next/link"
import { redirect } from "next/navigation"

import { createSupabaseServerUserClient } from "@/lib/supabase/server"

type OrganizationListItem = {
  id: string
  name: string
  slug: string
  status: string
}

export default async function DashboardPage() {
  const supabase = await createSupabaseServerUserClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect("/login")
  }

  const { data: memberships } = await supabase
    .from("organizations")
    .select("id, name, slug, status")
    .limit(20)
  const organizations: OrganizationListItem[] = memberships ?? []

  return (
    <main className="shell">
      <h1>Dashboard</h1>
      <section className="panel">
        <h2>Organizations</h2>
        {organizations.length > 0 ? (
          <ul>
            {organizations.map((organization) => (
              <li key={organization.id}>
                {organization.name}{" "}
                <span className="muted">/{organization.slug}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted">No organizations are visible for this user.</p>
        )}
        <Link className="button" href="/dashboard/sites">
          View sites
        </Link>
      </section>
    </main>
  )
}

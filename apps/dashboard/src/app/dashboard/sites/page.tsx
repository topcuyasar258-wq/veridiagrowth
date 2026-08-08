import { redirect } from "next/navigation"

import { createSupabaseServerUserClient } from "@/lib/supabase/server"

type SiteListItem = {
  id: string
  name: string
  status: string
  organization_id: string
}

export default async function SitesPage() {
  const supabase = await createSupabaseServerUserClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect("/login")
  }

  const { data: sites } = await supabase
    .from("sites")
    .select("id, name, status, organization_id")
    .order("created_at", { ascending: false })
  const visibleSites: SiteListItem[] = sites ?? []

  return (
    <main className="shell">
      <h1>Sites</h1>
      <section className="panel">
        {visibleSites.length > 0 ? (
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Status</th>
                <th>Organization</th>
              </tr>
            </thead>
            <tbody>
              {visibleSites.map((site) => (
                <tr key={site.id}>
                  <td>{site.name}</td>
                  <td>{site.status}</td>
                  <td>{site.organization_id}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="muted">No sites are visible for this user.</p>
        )}
      </section>
    </main>
  )
}

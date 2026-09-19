import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";

import { logout } from "./login/actions";

export default async function Home() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();

  if (!data?.claims) redirect("/login");

  const email = typeof data.claims.email === "string" ? data.claims.email : "Clinician";

  return (
    <main className="dashboard-shell">
      <header className="dashboard-header">
        <div className="dashboard-brand">
          <div className="brand-mark small" aria-hidden="true"><span /><span /></div>
          <span>Mediverse</span>
        </div>
        <form action={logout}>
          <button className="sign-out-button" type="submit">Sign out</button>
        </form>
      </header>
      <section className="dashboard-content">
        <p className="eyebrow">Workspace</p>
        <h1>You’re signed in.</h1>
        <p className="dashboard-email">{email}</p>
        <div className="empty-state">
          <span aria-hidden="true">✓</span>
          <div>
            <h2>Authentication is ready</h2>
            <p>Your Mediverse workspace can now build on this protected session.</p>
          </div>
        </div>
      </section>
    </main>
  );
}

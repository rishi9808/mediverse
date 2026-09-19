import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";

import { LoginForm } from "./login-form";
import { MediverseLogo } from "../mediverse-logo";

export default async function LoginPage() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();

  if (data?.claims) redirect("/");

  return (
    <main className="login-page">
      <section className="login-intro" aria-labelledby="login-heading">
        <MediverseLogo />
        <div>
          <p className="eyebrow">Mediverse</p>
          <h1 id="login-heading">Clinical notes, kept clear and reviewable.</h1>
          <p className="intro-copy">
            A focused workspace for turning session evidence into clinician-reviewed
            SOAP notes.
          </p>
        </div>
        <p className="privacy-note"><span aria-hidden="true">●</span> Secure clinician access</p>
      </section>
      <section className="login-panel" aria-label="Sign in">
        <div className="login-card">
          <div className="login-card-heading">
            <p className="eyebrow">Welcome back</p>
            <h2>Sign in to your workspace</h2>
            <p>Use the email and password linked to your clinician account.</p>
          </div>
          <LoginForm />
        </div>
        <p className="support-copy">Need access? Contact your workspace administrator.</p>
      </section>
    </main>
  );
}

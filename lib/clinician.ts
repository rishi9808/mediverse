import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";

function displayNameFromEmail(email: string | undefined) {
  const localPart = email?.split("@")[0]?.replace(/[._-]+/g, " ").trim();

  if (!localPart) return "Clinician";

  return localPart
    .split(" ")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ")
    .slice(0, 120);
}

export async function requireClinician() {
  const supabase = await createClient();
  const { data: authData, error: authError } = await supabase.auth.getClaims();
  const claims = authData?.claims;
  const userId = typeof claims?.sub === "string" ? claims.sub : null;

  if (authError || !userId) redirect("/login");

  const email =
    typeof claims?.email === "string" ? claims.email : undefined;
  const { data: existing, error: readError } = await supabase
    .from("clinicians")
    .select("id, display_name, profession")
    .eq("id", userId)
    .maybeSingle();

  if (readError) throw new Error("We could not load your clinician profile.");
  if (existing) return { supabase, clinician: existing, email };

  const { data: created, error: createError } = await supabase
    .from("clinicians")
    .insert({ id: userId, display_name: displayNameFromEmail(email) })
    .select("id, display_name, profession")
    .single();

  if (!createError && created) return { supabase, clinician: created, email };

  // A concurrent request may have created the same profile first.
  if (createError?.code === "23505") {
    const { data: racedProfile, error: racedError } = await supabase
      .from("clinicians")
      .select("id, display_name, profession")
      .eq("id", userId)
      .single();

    if (!racedError && racedProfile) {
      return { supabase, clinician: racedProfile, email };
    }
  }

  throw new Error("We could not prepare your clinician profile.");
}

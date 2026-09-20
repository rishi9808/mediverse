"use server";

import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";

export type LoginState = { message: string };

const REVIEWER_EMAIL = "clinician@mediverse.test";
const REVIEWER_PASSWORD = "med@123";

async function signIn(email: string, password: string, errorMessage: string): Promise<LoginState> {
  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) return { message: errorMessage };

  redirect("/");
}

export async function login(
  _previousState: LoginState,
  formData: FormData,
): Promise<LoginState> {
  const email = formData.get("email");
  const password = formData.get("password");

  if (typeof email !== "string" || typeof password !== "string") {
    return { message: "Enter your email and password." };
  }

  const normalizedEmail = email.trim().toLowerCase();
  if (!normalizedEmail || !password) {
    return { message: "Enter your email and password." };
  }

  return signIn(normalizedEmail, password, "The email or password is incorrect.");
}

export async function loginAsReviewer(_previousState: LoginState): Promise<LoginState> {
  void _previousState;
  return signIn(
    REVIEWER_EMAIL,
    REVIEWER_PASSWORD,
    "Reviewer access is temporarily unavailable. Use the demo credentials below.",
  );
}

export async function logout() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}

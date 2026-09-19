"use client";

import { useRouter } from "next/navigation";
import { useFormStatus } from "react-dom";

export function RetryButton({ label = "Try again" }: { label?: string }) {
  const router = useRouter();

  return (
    <button className="secondary-button" type="button" onClick={() => router.refresh()}>
      {label}
    </button>
  );
}

export function CreateSessionButton() {
  const { pending } = useFormStatus();

  return (
    <button className="primary-button" type="submit" disabled={pending}>
      {pending ? "Creating session…" : "Create session"}
    </button>
  );
}

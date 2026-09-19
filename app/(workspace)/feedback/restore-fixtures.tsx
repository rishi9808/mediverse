"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { restoreFictionalWorkspace } from "../actions";

export function RestoreFixtures() {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState("");

  function restore() {
    setMessage("");
    startTransition(async () => {
      const result = await restoreFictionalWorkspace();
      setMessage(result.message);
      setConfirming(false);
      router.refresh();
    });
  }

  return (
    <div className="fixture-reset">
      <div><h2>Restore fictional workspace</h2><p>Archives current fictional patient records and restores the short, long, waiting, and follow-up fixtures.</p></div>
      {!confirming ? <button className="secondary-button" type="button" onClick={() => setConfirming(true)}>Restore fixtures</button> : <div className="reset-confirmation"><p>Restore the workspace now?</p><button className="secondary-button" type="button" onClick={() => setConfirming(false)}>Cancel</button><button className="primary-button" disabled={pending} type="button" onClick={restore}>{pending ? "Restoring…" : "Confirm restore"}</button></div>}
      {message && <p className="audio-message" role="status">{message}</p>}
    </div>
  );
}

"use client";

import { useEffect, useState, type ReactNode } from "react";

const transcriptHashPrefix = "#transcript-segment-";

export function TranscriptDisclosure({ children }: { children: ReactNode }) {
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    function revealLinkedEvidence() {
      if (window.location.hash.startsWith(transcriptHashPrefix)) setExpanded(true);
    }

    revealLinkedEvidence();
    window.addEventListener("hashchange", revealLinkedEvidence);
    return () => window.removeEventListener("hashchange", revealLinkedEvidence);
  }, []);

  useEffect(() => {
    if (!expanded || !window.location.hash.startsWith(transcriptHashPrefix)) return;
    window.requestAnimationFrame(() => {
      document.querySelector(window.location.hash)?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
  }, [expanded]);

  return (
    <section aria-label="Session transcript">
      <button
        aria-controls="session-transcript"
        aria-expanded={expanded}
        className="secondary-button"
        onClick={() => setExpanded((current) => !current)}
        type="button"
      >
        {expanded ? "Hide transcript" : "View transcript"}
      </button>
      <div hidden={!expanded} id="session-transcript">
        {children}
      </div>
    </section>
  );
}

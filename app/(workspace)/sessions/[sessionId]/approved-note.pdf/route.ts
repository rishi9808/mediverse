import { createApprovedNotePdf, parseApprovedNoteSnapshot } from "@/lib/approved-note-pdf";
import { requireClinician } from "@/lib/clinician";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  context: RouteContext<"/sessions/[sessionId]/approved-note.pdf">,
) {
  const { sessionId } = await context.params;
  const { supabase, clinician } = await requireClinician();
  const { data: approvedNote, error } = await supabase
    .from("approved_notes")
    .select("snapshot")
    .eq("session_id", sessionId)
    .eq("clinician_id", clinician.id)
    .maybeSingle();

  if (error) return new Response("The approved note could not be loaded.", { status: 500 });
  if (!approvedNote) return new Response("Only an approved note can be exported.", { status: 404 });

  try {
    const snapshot = parseApprovedNoteSnapshot(approvedNote.snapshot);
    const bytes = await createApprovedNotePdf(snapshot);
    const filename = `mediverse-${snapshot.patient.display_code.replace(/[^a-z0-9_-]/gi, "-")}-approved-soap.pdf`;
    return new Response(bytes.slice().buffer, {
      headers: {
        "Cache-Control": "private, no-store, max-age=0",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Content-Type": "application/pdf",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return new Response("The immutable approved snapshot is invalid.", { status: 422 });
  }
}

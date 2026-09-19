import { requireClinician } from "@/lib/clinician";
import { WorkspaceSidebar } from "./sidebar";

export default async function WorkspaceLayout({ children }: LayoutProps<"/">) {
  const { clinician, email } = await requireClinician();
  return (
    <div className="workspace-shell">
      <WorkspaceSidebar displayName={clinician.display_name} email={email ?? "Psychologist"} />

      <div className="workspace-main">
        {children}
      </div>
    </div>
  );
}

import Link from "next/link";

import { requireClinician } from "@/lib/clinician";

import { logout } from "../login/actions";
import { PatientsIcon, PlusIcon } from "./icons";

export default async function WorkspaceLayout({ children }: LayoutProps<"/">) {
  const { clinician, email } = await requireClinician();
  const initials = clinician.display_name
    .split(" ")
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  return (
    <div className="workspace-shell">
      <aside className="workspace-sidebar">
        <Link className="workspace-brand" href="/" aria-label="Mediverse patient workspace">
          <span className="brand-mark small" aria-hidden="true"><span /><span /></span>
          <span>Mediverse</span>
        </Link>

        <nav className="workspace-nav" aria-label="Workspace navigation">
          <Link className="nav-link active" href="/">
            <PatientsIcon />
            Patients
          </Link>
          <Link className="nav-link" href="/patients/new">
            <PlusIcon />
            New patient
          </Link>
        </nav>

        <div className="sidebar-profile">
          <div className="profile-avatar" aria-hidden="true">{initials}</div>
          <div className="profile-copy">
            <strong>{clinician.display_name}</strong>
            <span>{email ?? "Psychologist"}</span>
          </div>
          <form action={logout}>
            <button className="text-button" type="submit">Sign out</button>
          </form>
        </div>
      </aside>

      <div className="workspace-main">
        {children}
      </div>
    </div>
  );
}

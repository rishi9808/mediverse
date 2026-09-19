"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

import { logout } from "../login/actions";
import { CalendarIcon, EditIcon, PatientsIcon, PlusIcon } from "./icons";

const navigation = [
  { href: "/", label: "Dashboard", icon: CalendarIcon },
  { href: "/patients", label: "Patients", icon: PatientsIcon },
  { href: "/patients/new", label: "Onboard patient", icon: PlusIcon },
  { href: "/feedback", label: "Share feedback", icon: EditIcon },
];

export function WorkspaceSidebar({
  displayName,
  email,
}: {
  displayName: string;
  email: string;
}) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      setCollapsed(window.localStorage.getItem("mediverse-sidebar") === "collapsed");
    });
    return () => window.cancelAnimationFrame(frame);
  }, []);

  function toggleSidebar() {
    setCollapsed((current) => {
      const next = !current;
      window.localStorage.setItem("mediverse-sidebar", next ? "collapsed" : "expanded");
      return next;
    });
  }

  const initials = displayName
    .split(" ")
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  return (
    <aside className={`workspace-sidebar${collapsed ? " collapsed" : ""}`}>
      <div className="sidebar-topline">
        <Link className="workspace-brand" href="/" aria-label="Mediverse dashboard">
          <span className="brand-mark small" aria-hidden="true"><span /><span /></span>
          <span className="sidebar-label">Mediverse</span>
        </Link>
        <button
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          className="sidebar-toggle"
          onClick={toggleSidebar}
          title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          type="button"
        >
          <span aria-hidden="true">{collapsed ? ">" : "<"}</span>
        </button>
      </div>

      <nav className="workspace-nav" aria-label="Workspace navigation">
        {navigation.map((item) => {
          const active = item.href === "/"
            ? pathname === "/"
            : pathname === item.href || pathname.startsWith(`${item.href}/`);
          const Icon = item.icon;
          return (
            <Link
              aria-current={active ? "page" : undefined}
              className={`nav-link${active ? " active" : ""}`}
              href={item.href}
              key={item.href}
              title={collapsed ? item.label : undefined}
            >
              <Icon />
              <span className="sidebar-label">{item.label}</span>
            </Link>
          );
        })}
      </nav>

      <div className="sidebar-profile">
        <div className="profile-avatar" aria-hidden="true">{initials}</div>
        <div className="profile-copy sidebar-label">
          <strong>{displayName}</strong>
          <span>{email}</span>
        </div>
        <form action={logout} className="sidebar-label">
          <button className="text-button" type="submit">Sign out</button>
        </form>
      </div>
    </aside>
  );
}

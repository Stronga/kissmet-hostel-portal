import { useState } from "react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { useAuth } from "../../auth/AuthContext";
import { MobileNav } from "./MobileNav";
import { ResidentHeader } from "./ResidentHeader";
import { allNavItems, portalTitle } from "./navigation";

export function ResidentShell() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [isMoreOpen, setIsMoreOpen] = useState(false);

  async function handleLogout() {
    await logout();
    navigate("/login", { replace: true });
  }

  return (
    <div className="min-h-screen bg-background pb-24 md:pb-0">
      <ResidentHeader displayName={user?.displayName} onLogout={handleLogout} />
      <div className="mx-auto grid max-w-6xl grid-cols-1 gap-6 px-4 py-5 md:grid-cols-[220px_1fr] md:px-6">
        <aside className="sticky top-[73px] hidden self-start rounded-token border border-border bg-surface p-3 shadow-token md:block">
          <p className="px-3 pb-3 text-sm font-semibold text-text-primary">{portalTitle}</p>
          <nav className="space-y-1" aria-label="Resident navigation">
            {allNavItems.map((item) => (
              <NavLink
                key={item.href}
                to={item.href}
                className={({ isActive }) =>
                  `flex min-h-11 items-center gap-3 rounded-token px-3 py-2 text-sm font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary ${
                    isActive ? "bg-muted text-primary" : "text-text-secondary hover:bg-muted hover:text-text-primary"
                  }`
                }
              >
                <item.icon size={18} aria-hidden="true" />
                {item.label}
              </NavLink>
            ))}
          </nav>
        </aside>
        <main className="min-w-0">
          <Outlet />
        </main>
      </div>
      <MobileNav
        isMoreOpen={isMoreOpen}
        onToggleMore={() => setIsMoreOpen((value) => !value)}
        onCloseMore={() => setIsMoreOpen(false)}
        onLogout={handleLogout}
      />
    </div>
  );
}

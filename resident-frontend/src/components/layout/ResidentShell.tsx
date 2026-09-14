import { ArrowRight, Headset } from "lucide-react";
import { useState } from "react";
import { Link, NavLink, Outlet, useNavigate } from "react-router-dom";
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
    <div className="min-h-screen bg-background pb-24 lg:pb-0">
      <ResidentHeader displayName={user?.displayName} onLogout={handleLogout} />
      {/* Desktop shell uses lg (1024px)+; below that keeps existing mobile bottom nav presentation. */}
      <div className="mx-auto grid max-w-6xl grid-cols-1 gap-6 px-4 py-5 lg:mx-0 lg:max-w-none lg:grid-cols-[280px_minmax(0,1fr)] lg:gap-0 lg:px-0 lg:py-0">
        <aside className="sticky top-[73px] hidden self-start rounded-token border border-border bg-surface p-3 shadow-token lg:flex lg:h-[calc(100vh-73px)] lg:max-h-[calc(100vh-73px)] lg:flex-col lg:overflow-y-auto lg:rounded-none lg:border-0 lg:border-r lg:border-[#eaeff2] lg:bg-white lg:p-8 lg:shadow-none">
          <div className="mb-10 hidden items-center gap-3 px-2 lg:flex">
            <div className="flex h-9 w-9 items-center justify-center rounded-[10px] bg-primary text-lg font-bold text-white" aria-hidden="true">
              K
            </div>
            <div>
              <p className="text-lg font-bold leading-tight text-text-primary">Kissmet</p>
              <p className="text-[11px] font-semibold tracking-wide text-text-secondary">HOSTEL</p>
            </div>
          </div>
          <p className="px-3 pb-3 text-sm font-semibold text-text-primary lg:hidden">{portalTitle}</p>
          <nav className="flex-1 space-y-1 lg:space-y-2" aria-label="Resident navigation">
            {allNavItems.map((item) => (
              <NavLink
                key={item.href}
                to={item.href}
                className={({ isActive }) =>
                  `flex min-h-11 items-center gap-3 rounded-token px-3 py-2 text-sm font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary lg:gap-4 lg:rounded-full lg:px-5 lg:py-3.5 lg:text-[15px] ${
                    isActive
                      ? "bg-muted text-primary lg:bg-primary lg:text-white"
                      : "text-text-secondary hover:bg-muted hover:text-text-primary lg:hover:bg-[#f7f9fa]"
                  }`
                }
              >
                <item.icon size={18} className="lg:h-[22px] lg:w-[22px]" aria-hidden="true" />
                {item.label}
              </NavLink>
            ))}
          </nav>
          <Link
            to="/maintenance"
            className="mt-8 hidden items-center gap-3 rounded-3xl bg-[#f7f9fa] p-4 lg:flex"
          >
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white text-primary shadow-[0_2px_10px_rgba(0,0,0,0.02)]">
              <Headset size={18} aria-hidden="true" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-semibold text-text-primary">Need Help?</span>
              <span className="block text-xs text-text-secondary">Report an issue</span>
            </span>
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary text-white" aria-hidden="true">
              <ArrowRight size={16} />
            </span>
          </Link>
        </aside>
        <main className="min-w-0 lg:px-10 lg:py-8">
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

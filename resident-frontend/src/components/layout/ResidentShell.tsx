import { ArrowRight, Headset, LogOut, UserRound } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { Link, NavLink, Outlet, useNavigate } from "react-router-dom";
import { useAuth } from "../../auth/AuthContext";
import { statusLabel } from "../../utils/format";
import { MobileNav } from "./MobileNav";
import { ResidentHeader } from "./ResidentHeader";
import { allNavItems, portalTitle } from "./navigation";

export interface ResidentShellOutletContext {
  setChromeStatus: (status: string | null | undefined) => void;
}

export function ResidentShell() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [isMoreOpen, setIsMoreOpen] = useState(false);
  const [chromeStatus, setChromeStatusState] = useState<string | null>(null);

  const setChromeStatus = useCallback((status: string | null | undefined) => {
    setChromeStatusState(status ?? null);
  }, []);

  const outletContext = useMemo<ResidentShellOutletContext>(
    () => ({ setChromeStatus }),
    [setChromeStatus]
  );

  async function handleLogout() {
    await logout();
    navigate("/login", { replace: true });
  }

  const initials = user?.displayName
    ? user.displayName
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 2)
        .map((part) => part[0]?.toUpperCase() ?? "")
        .join("") || "R"
    : null;

  const statusText = chromeStatus ? statusLabel(chromeStatus) : null;

  return (
    <div className="min-h-screen bg-background pb-24 xl:pb-0">
      {/* Mobile/tablet keeps the existing top brand bar. Desktop replaces it with the sidebar Kissmet mark. */}
      <ResidentHeader displayName={user?.displayName} onLogout={handleLogout} />

      {/* Full desktop chrome (sidebar) uses xl (~1200px)+; below that keeps mobile/tablet nav. */}
      <div className="mx-auto grid max-w-6xl grid-cols-1 gap-6 px-4 py-5 xl:mx-0 xl:max-w-none xl:min-h-screen xl:grid-cols-[280px_minmax(0,1fr)] xl:gap-0 xl:px-0 xl:py-0">
        <aside className="sticky top-[73px] hidden self-start rounded-token border border-border bg-surface p-3 shadow-token xl:sticky xl:top-0 xl:flex xl:h-screen xl:max-h-screen xl:flex-col xl:overflow-y-auto xl:rounded-none xl:border-0 xl:border-r xl:border-[#eaeff2] xl:bg-white xl:p-8 xl:shadow-none">
          <div className="mb-10 flex items-center gap-3 px-2">
            <div
              className="flex h-9 w-9 items-center justify-center rounded-[10px] bg-primary text-lg font-bold text-white"
              aria-hidden="true"
            >
              K
            </div>
            <div>
              <p className="text-lg font-bold leading-tight text-text-primary">Kissmet</p>
              <p className="text-[11px] font-semibold tracking-wide text-text-secondary">HOSTEL</p>
            </div>
          </div>
          <p className="px-3 pb-3 text-sm font-semibold text-text-primary xl:hidden">{portalTitle}</p>
          <nav className="flex-1 space-y-1 xl:space-y-2" aria-label="Resident navigation">
            {allNavItems.map((item) => (
              <NavLink
                key={item.href}
                to={item.href}
                className={({ isActive }) =>
                  `flex min-h-11 items-center gap-3 rounded-token px-3 py-2 text-sm font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary xl:gap-4 xl:rounded-full xl:px-5 xl:py-3.5 xl:text-[15px] ${
                    isActive
                      ? "bg-muted text-primary xl:bg-primary xl:text-white"
                      : "text-text-secondary hover:bg-muted hover:text-text-primary xl:hover:bg-[#f7f9fa]"
                  }`
                }
              >
                <item.icon size={18} className="xl:h-[22px] xl:w-[22px]" aria-hidden="true" />
                {item.label}
              </NavLink>
            ))}
          </nav>
          <Link
            to="/maintenance"
            className="mt-8 hidden items-center gap-3 rounded-3xl bg-[#f7f9fa] p-4 xl:flex"
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

        <main className="min-w-0 overflow-x-clip xl:overflow-y-visible xl:px-10 xl:pb-10 xl:pt-6">
          {/* Desktop user actions — intentional lightweight containers */}
          <div className="mb-6 hidden items-center justify-end gap-2.5 xl:flex">
            {initials ? (
              <span
                className="flex h-10 w-10 items-center justify-center rounded-full border border-[#d6eae5] bg-[#ebf8f5] text-sm font-semibold text-primary shadow-[0_1px_2px_rgba(0,0,0,0.03)]"
                title={user?.displayName}
                aria-label={user?.displayName}
              >
                {initials}
              </span>
            ) : null}
            {statusText ? (
              <span
                className="inline-flex items-center gap-1.5 rounded-full border border-[#eaeff2] bg-white px-3.5 py-2 text-xs font-semibold text-text-secondary shadow-[0_1px_2px_rgba(0,0,0,0.03)]"
                aria-label={`Status: ${statusText}`}
              >
                <UserRound size={14} className="text-primary" aria-hidden="true" />
                {statusText}
              </span>
            ) : null}
            <button
              type="button"
              onClick={() => void handleLogout()}
              aria-label="Logout"
              className="inline-flex min-h-10 items-center gap-2 rounded-full border border-[#eaeff2] bg-white px-4 py-2 text-sm font-semibold text-text-secondary shadow-[0_1px_2px_rgba(0,0,0,0.03)] transition hover:bg-[#f7f9fa] hover:text-text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
            >
              <LogOut size={16} aria-hidden="true" />
              <span>Logout</span>
            </button>
          </div>
          <Outlet context={outletContext} />
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

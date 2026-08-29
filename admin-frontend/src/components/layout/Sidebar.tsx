import { NavLink } from "react-router-dom";
import { navGroups } from "./navigation";
import type { RoleCode } from "../../types/api";

export function Sidebar({ role, onNavigate }: { role: RoleCode; onNavigate?: () => void }) {
  return (
    <aside className="flex h-full w-64 flex-col border-r border-border bg-surface">
      <div className="border-b border-border px-5 py-4">
        <p className="text-lg font-semibold text-text-primary">Kissmet</p>
        <p className="text-xs text-text-secondary">Hostel Admin Portal</p>
      </div>
      <nav aria-label="Admin navigation" className="flex-1 overflow-y-auto px-3 py-4">
        {navGroups.map((group) => {
          const items = group.items.filter((item) => !item.roles || item.roles.includes(role));
          if (!items.length) return null;
          return (
            <div key={group.label} className="mb-5">
              <p className="px-2 text-[11px] font-semibold uppercase tracking-wide text-text-secondary">{group.label}</p>
              <div className="mt-2 space-y-1">
                {items.map((item) => {
                  const Icon = item.icon;
                  return (
                    <NavLink
                      key={item.to}
                      to={item.to}
                      onClick={onNavigate}
                      className={({ isActive }) => `flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium outline-none transition focus-visible:ring-2 focus-visible:ring-primary ${isActive ? "bg-primary text-white" : "text-text-secondary hover:bg-muted hover:text-text-primary"}`}
                    >
                      <Icon className="h-4 w-4" aria-hidden />
                      {item.label}
                    </NavLink>
                  );
                })}
              </div>
            </div>
          );
        })}
      </nav>
    </aside>
  );
}

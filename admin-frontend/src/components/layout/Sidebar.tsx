import { NavLink } from "react-router-dom";
import { BrandMark } from "../../design-system/react/BrandMark";
import { NavShell, type NavShellGroup } from "../../design-system/react/NavShell";
import type { RoleCode } from "../../types/api";
import { navGroups } from "./navigation";

export function Sidebar({
  role,
  collapsed = false,
  onToggleCollapsed,
  onNavigate
}: {
  role: RoleCode;
  collapsed?: boolean;
  onToggleCollapsed?: () => void;
  onNavigate?: () => void;
}) {
  const groups: NavShellGroup[] = navGroups
    .map((group) => ({
      id: group.label.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
      label: group.label,
      items: group.items
        .filter((item) => !item.roles || item.roles.includes(role))
        .map((item) => ({
          id: item.to,
          label: item.label,
          href: item.to,
          icon: <item.icon className="h-4 w-4 shrink-0" aria-hidden />
        }))
    }))
    .filter((group) => group.items.length > 0);

  return (
    <NavShell
      label="Admin navigation"
      groups={groups}
      collapsed={collapsed}
      onToggleCollapsed={onToggleCollapsed}
      onNavigate={onNavigate}
      brand={
        <div className={collapsed ? "flex justify-center" : "flex items-center gap-3"}>
          <BrandMark height={collapsed ? 36 : 56} alt={collapsed ? "Kissmet" : ""} />
          {collapsed ? null : (
            <div>
              <p className="text-base font-semibold leading-tight text-text-primary">Kissmet</p>
              <p className="text-xs text-text-secondary">Hostel Admin</p>
            </div>
          )}
        </div>
      }
      renderItem={(item) => (
        <NavLink
          to={item.href}
          title={item.label}
          className={({ isActive }) => `km-nav__link${isActive ? " km-nav__link--active" : ""}`}
        >
          {item.icon}
          <span className={collapsed ? "km-sr-only" : undefined}>{item.label}</span>
        </NavLink>
      )}
    />
  );
}

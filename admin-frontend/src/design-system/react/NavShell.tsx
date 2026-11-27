import { useId, useState, type ReactNode } from "react";

export interface NavShellItem {
  id: string;
  label: string;
  href: string;
  icon?: ReactNode;
}

export interface NavShellGroup {
  id: string;
  label: string;
  items: NavShellItem[];
}

export function NavShell({
  groups,
  brand,
  footer,
  collapsed = false,
  onToggleCollapsed,
  onNavigate,
  label,
  renderItem
}: {
  groups: NavShellGroup[];
  brand?: ReactNode;
  footer?: ReactNode;
  collapsed?: boolean;
  onToggleCollapsed?: () => void;
  onNavigate?: () => void;
  label: string;
  renderItem: (item: NavShellItem, group: NavShellGroup) => ReactNode;
}) {
  const baseId = useId();
  const [closed, setClosed] = useState<Record<string, boolean>>({});

  return (
    <div className={collapsed ? "km-nav km-nav--collapsed" : "km-nav"}>
      <div className="km-nav__brand">{brand}</div>
      {onToggleCollapsed ? (
        <button
          type="button"
          className="km-btn km-btn--ghost km-nav__collapse"
          aria-pressed={collapsed}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          onClick={onToggleCollapsed}
        >
          <span aria-hidden="true">{collapsed ? "»" : "«"}</span>
          <span className={collapsed ? "km-sr-only" : undefined}>{collapsed ? "Expand sidebar" : "Collapse sidebar"}</span>
        </button>
      ) : null}
      <nav className="km-nav__scroll" aria-label={label}>
        {groups.map((group) => {
          const open = collapsed || !closed[group.id];
          const panelId = `${baseId}-${group.id}`;
          return (
            <div key={group.id} className="km-nav__group">
              {collapsed ? (
                <h2 className="km-sr-only">{group.label}</h2>
              ) : (
                <button
                  type="button"
                  className="km-nav__group-toggle"
                  aria-expanded={open}
                  aria-controls={panelId}
                  onClick={() => setClosed((current) => ({ ...current, [group.id]: !current[group.id] }))}
                >
                  <span>{group.label}</span>
                  <span aria-hidden="true">{open ? "▾" : "▸"}</span>
                </button>
              )}
              <div id={panelId} className="km-nav__items" hidden={!open}>
                <ul>
                  {group.items.map((item) => (
                    <li key={item.id} onClick={onNavigate}>{renderItem(item, group)}</li>
                  ))}
                </ul>
              </div>
            </div>
          );
        })}
      </nav>
      {footer ? <div className="km-nav__footer">{footer}</div> : null}
    </div>
  );
}

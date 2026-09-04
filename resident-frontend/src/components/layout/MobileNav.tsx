import { Menu } from "lucide-react";
import { NavLink, useLocation } from "react-router-dom";
import { Button } from "../common/Button";
import { moreNavItems, primaryNavItems } from "./navigation";

interface MobileNavProps {
  isMoreOpen: boolean;
  onToggleMore: () => void;
  onCloseMore: () => void;
  onLogout: () => void;
}

const moreHrefs = moreNavItems.map((item) => item.href);

export function MobileNav({ isMoreOpen, onToggleMore, onCloseMore, onLogout }: MobileNavProps) {
  const location = useLocation();
  const onMoreRoute = moreHrefs.some((href) => location.pathname === href || location.pathname.startsWith(`${href}/`));
  const moreActive = isMoreOpen || onMoreRoute;

  return (
    <>
      {isMoreOpen ? (
        <div className="fixed inset-x-3 bottom-20 z-30 rounded-token border border-border bg-surface p-3 shadow-token md:hidden">
          <nav className="grid grid-cols-2 gap-2" aria-label="More resident navigation">
            {moreNavItems.map((item) => (
              <NavLink
                key={item.href}
                to={item.href}
                onClick={onCloseMore}
                className={({ isActive }) =>
                  `flex min-h-11 items-center gap-2 rounded-token px-3 py-2 text-sm font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary ${
                    isActive ? "bg-muted text-primary" : "text-text-secondary hover:bg-muted"
                  }`
                }
              >
                <item.icon size={18} aria-hidden="true" />
                {item.label}
              </NavLink>
            ))}
          </nav>
          <Button className="mt-3 w-full" variant="secondary" onClick={onLogout}>Logout</Button>
        </div>
      ) : null}
      <nav className="fixed inset-x-0 bottom-0 z-20 border-t border-border bg-surface px-2 pb-2 pt-1 md:hidden" aria-label="Primary resident navigation">
        <div className="mx-auto grid max-w-lg grid-cols-5 gap-1">
          {primaryNavItems.map((item) => (
            <NavLink
              key={item.href}
              to={item.href}
              className={({ isActive }) =>
                `flex min-h-14 flex-col items-center justify-center rounded-token text-[11px] font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary ${
                  isActive ? "bg-muted text-primary" : "text-text-secondary"
                }`
              }
            >
              <item.icon size={19} aria-hidden="true" />
              {item.label}
            </NavLink>
          ))}
          <button
            type="button"
            onClick={onToggleMore}
            className={`flex min-h-14 flex-col items-center justify-center rounded-token text-[11px] font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary ${
              moreActive ? "bg-muted text-primary" : "text-text-secondary"
            }`}
            aria-expanded={isMoreOpen}
            aria-current={onMoreRoute && !isMoreOpen ? "page" : undefined}
          >
            <Menu size={19} aria-hidden="true" />
            More
          </button>
        </div>
      </nav>
    </>
  );
}

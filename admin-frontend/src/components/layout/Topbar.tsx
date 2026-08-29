import { Bell, LogOut, Menu } from "lucide-react";
import { useAuth } from "../../auth/AuthContext";
import { formatStatus } from "../../utils/format";

export function Topbar({ onMenuClick }: { onMenuClick: () => void }) {
  const { user, logout } = useAuth();
  return (
    <header className="flex h-16 items-center justify-between border-b border-border bg-surface px-4 lg:px-6">
      <div className="flex items-center gap-3">
        <button type="button" className="rounded-md p-2 text-text-secondary hover:bg-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-primary lg:hidden" onClick={onMenuClick} aria-label="Open navigation">
          <Menu className="h-5 w-5" />
        </button>
        <div>
          <p className="text-sm font-semibold text-text-primary">Admin Portal</p>
          <p className="text-xs text-text-secondary">admin.kissmetgroup.org</p>
        </div>
      </div>
      <div className="flex items-center gap-3">
        <button type="button" className="rounded-md p-2 text-text-secondary hover:bg-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-primary" aria-label="Notifications">
          <Bell className="h-5 w-5" />
        </button>
        <div className="hidden text-right sm:block">
          <p className="text-sm font-medium text-text-primary">{user?.displayName ?? "Staff"}</p>
          <p className="text-xs text-text-secondary">{formatStatus(user?.role)}</p>
        </div>
        <div className="flex h-9 w-9 items-center justify-center rounded-full bg-muted text-sm font-semibold text-text-primary" aria-hidden>
          {(user?.displayName ?? "S").slice(0, 1).toUpperCase()}
        </div>
        <button type="button" onClick={() => void logout()} className="rounded-md p-2 text-text-secondary hover:bg-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-primary" aria-label="Log out">
          <LogOut className="h-5 w-5" />
        </button>
      </div>
    </header>
  );
}

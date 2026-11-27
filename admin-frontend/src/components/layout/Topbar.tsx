import { useEffect, useState } from "react";
import { Bell, KeyRound, LogOut, Menu } from "lucide-react";
import { Link } from "react-router-dom";
import { activityUnreadCount } from "../../api/activity";
import { BrandMark } from "../../design-system/react/BrandMark";
import { useAuth } from "../../auth/AuthContext";
import { formatStatus } from "../../utils/format";

export function Topbar({ onMenuClick }: { onMenuClick: () => void }) {
  const { user, logout } = useAuth();
  const [unread, setUnread] = useState(0);
  useEffect(() => {
    if (!user) return;
    let alive = true;
    activityUnreadCount().then((count) => { if (alive) setUnread(count); }).catch(() => { if (alive) setUnread(0); });
    return () => { alive = false; };
  }, [user]);
  return (
    <header className="flex h-16 items-center justify-between border-b border-border bg-surface px-4 lg:px-6">
      <div className="flex items-center gap-3">
        <button type="button" className="rounded-md p-2 text-text-secondary hover:bg-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-primary lg:hidden" onClick={onMenuClick} aria-label="Open navigation">
          <Menu className="h-5 w-5" />
        </button>
        <BrandMark className="lg:hidden" height={36} alt="" />
        <div>
          <p className="text-sm font-semibold text-text-primary">Admin Portal</p>
          <p className="text-xs text-text-secondary">admin.kissmetgroup.org</p>
        </div>
      </div>
      <div className="flex items-center gap-3">
        <Link to="/dashboard" className="relative rounded-md p-2 text-text-secondary hover:bg-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-primary" aria-label={unread ? `Activity, ${unread} unread` : "Activity"}>
          <Bell className="h-5 w-5" />
          {unread ? <span className="absolute right-1 top-1 inline-flex min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold text-white">{unread}</span> : null}
        </Link>
        <div className="hidden text-right sm:block">
          <p className="text-sm font-medium text-text-primary">{user?.displayName ?? "Staff"}</p>
          <p className="text-xs text-text-secondary">{formatStatus(user?.role)}</p>
        </div>
        <div className="flex h-9 w-9 items-center justify-center rounded-full bg-muted text-sm font-semibold text-text-primary" aria-hidden>
          {(user?.displayName ?? "S").slice(0, 1).toUpperCase()}
        </div>
        <Link to="/change-password" className="rounded-md p-2 text-text-secondary hover:bg-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-primary" aria-label="Change password" title="Change password">
          <KeyRound className="h-5 w-5" />
        </Link>
        <button type="button" onClick={() => void logout()} className="rounded-md p-2 text-text-secondary hover:bg-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-primary" aria-label="Log out">
          <LogOut className="h-5 w-5" />
        </button>
      </div>
    </header>
  );
}

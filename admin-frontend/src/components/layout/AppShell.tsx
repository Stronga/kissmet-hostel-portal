import { useState } from "react";
import { Outlet } from "react-router-dom";
import { useAuth } from "../../auth/AuthContext";
import { Sidebar } from "./Sidebar";
import { Topbar } from "./Topbar";

export function AppShell() {
  const [open, setOpen] = useState(false);
  const { user } = useAuth();
  const role = user?.role ?? "resident";

  return (
    <div className="min-h-screen bg-background text-text-primary">
      <div className="fixed inset-y-0 left-0 hidden lg:block">
        <Sidebar role={role} />
      </div>
      {open ? (
        <div className="fixed inset-0 z-40 lg:hidden">
          <button className="absolute inset-0 bg-black/40" aria-label="Close navigation" onClick={() => setOpen(false)} />
          <div className="relative h-full w-72">
            <Sidebar role={role} onNavigate={() => setOpen(false)} />
          </div>
        </div>
      ) : null}
      <div className="lg:pl-64">
        <Topbar onMenuClick={() => setOpen(true)} />
        <main className="p-4 lg:p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

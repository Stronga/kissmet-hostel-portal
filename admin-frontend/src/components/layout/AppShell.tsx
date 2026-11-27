import { useState } from "react";
import { Outlet } from "react-router-dom";
import { Drawer } from "../../design-system/react/Drawer";
import { useAuth } from "../../auth/AuthContext";
import { Sidebar } from "./Sidebar";
import { Topbar } from "./Topbar";

export function AppShell() {
  const [open, setOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const { user } = useAuth();
  const role = user?.role ?? "resident";

  return (
    <div className="min-h-screen bg-background text-text-primary">
      <div className={`fixed inset-y-0 left-0 z-30 hidden lg:block ${collapsed ? "w-20" : "w-72"}`}>
        <Sidebar role={role} collapsed={collapsed} onToggleCollapsed={() => setCollapsed((value) => !value)} />
      </div>
      <Drawer
        className="lg:hidden"
        open={open}
        side="left"
        title="Admin navigation"
        hideTitle
        onClose={() => setOpen(false)}
      >
        <Sidebar role={role} onNavigate={() => setOpen(false)} />
      </Drawer>
      <div className={collapsed ? "lg:pl-20" : "lg:pl-72"}>
        <Topbar onMenuClick={() => setOpen(true)} />
        <main className="p-4 lg:p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

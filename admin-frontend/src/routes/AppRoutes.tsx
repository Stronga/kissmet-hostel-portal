import { Navigate, Route, Routes } from "react-router-dom";
import { AppShell } from "../components/layout/AppShell";
import { ApplicationsPage } from "../pages/Applications/ApplicationsPage";
import { DashboardPage } from "../pages/Dashboard/DashboardPage";
import { LoginPage } from "../pages/Login/LoginPage";
import { PlaceholderPage } from "../pages/PlaceholderPage";
import { ResidentsPage } from "../pages/Residents/ResidentsPage";
import { ProtectedRoute } from "./ProtectedRoute";

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route element={<ProtectedRoute />}>
        <Route element={<AppShell />}>
          <Route index element={<Navigate to="/dashboard" replace />} />
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="/residents" element={<ResidentsPage />} />
          <Route path="/applications" element={<ApplicationsPage />} />
          <Route path="/bookings" element={<PlaceholderPage title="Bookings" />} />
          <Route path="/rooms" element={<PlaceholderPage title="Rooms & Beds" />} />
          <Route path="/allocations" element={<PlaceholderPage title="Allocations" />} />
          <Route path="/payments" element={<PlaceholderPage title="Payments" />} />
          <Route path="/receipts" element={<PlaceholderPage title="Receipts" />} />
          <Route path="/maintenance" element={<PlaceholderPage title="Maintenance" />} />
          <Route path="/announcements" element={<PlaceholderPage title="Announcements" />} />
          <Route path="/reports" element={<PlaceholderPage title="Reports" />} />
          <Route path="/staff" element={<PlaceholderPage title="Staff" />} />
          <Route path="/audit-logs" element={<PlaceholderPage title="Audit Logs" />} />
          <Route path="/settings" element={<PlaceholderPage title="Settings" />} />
        </Route>
      </Route>
      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
  );
}

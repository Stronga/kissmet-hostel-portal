import { Navigate, Route, Routes } from "react-router-dom";
import { AppShell } from "../components/layout/AppShell";
import { AllocationsPage } from "../pages/Allocations/AllocationsPage";
import { ApplicationsPage } from "../pages/Applications/ApplicationsPage";
import { BookingsPage } from "../pages/Bookings/BookingsPage";
import { DashboardPage } from "../pages/Dashboard/DashboardPage";
import { LoginPage } from "../pages/Login/LoginPage";
import { PlaceholderPage } from "../pages/PlaceholderPage";
import { ResidentsPage } from "../pages/Residents/ResidentsPage";
import { RoomsPage } from "../pages/Rooms/RoomsPage";
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
          <Route path="/bookings" element={<BookingsPage />} />
          <Route path="/rooms" element={<RoomsPage />} />
          <Route path="/allocations" element={<AllocationsPage />} />
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

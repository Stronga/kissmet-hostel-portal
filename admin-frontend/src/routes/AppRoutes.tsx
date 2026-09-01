import { Navigate, Route, Routes } from "react-router-dom";
import { AppShell } from "../components/layout/AppShell";
import { AllocationsPage } from "../pages/Allocations/AllocationsPage";
import { AnnouncementsPage } from "../pages/Announcements/AnnouncementsPage";
import { ApplicationsPage } from "../pages/Applications/ApplicationsPage";
import { BookingsPage } from "../pages/Bookings/BookingsPage";
import { DashboardPage } from "../pages/Dashboard/DashboardPage";
import { LoginPage } from "../pages/Login/LoginPage";
import { MaintenancePage } from "../pages/Maintenance/MaintenancePage";
import { MessagesPage } from "../pages/Messages/MessagesPage";
import { PaymentsPage } from "../pages/Payments/PaymentsPage";
import { PlaceholderPage } from "../pages/PlaceholderPage";
import { ReceiptsPage } from "../pages/Receipts/ReceiptsPage";
import { ReportsPage } from "../pages/Reports/ReportsPage";
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
          <Route path="/payments" element={<PaymentsPage />} />
          <Route path="/receipts" element={<ReceiptsPage />} />
          <Route path="/maintenance" element={<MaintenancePage />} />
          <Route path="/announcements" element={<AnnouncementsPage />} />
          <Route path="/messages" element={<MessagesPage />} />
          <Route path="/reports" element={<ReportsPage />} />
          <Route path="/staff" element={<PlaceholderPage title="Staff" />} />
          <Route path="/audit-logs" element={<PlaceholderPage title="Audit Logs" />} />
          <Route path="/settings" element={<PlaceholderPage title="Settings" />} />
        </Route>
      </Route>
      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
  );
}

import { Suspense, lazy } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { AppShell } from "../components/layout/AppShell";
import { LoadingState } from "../components/common/LoadingState";
import { LoginPage } from "../pages/Login/LoginPage";
import { RequirePermission } from "../components/auth/RequirePermission";
import { ProtectedRoute } from "./ProtectedRoute";
// Eager (not lazy): the forced password-change screen must render even if a page chunk fails to load.
import { ChangePasswordPage } from "../pages/Account/ChangePasswordPage";

const AllocationsPage = lazy(() => import("../pages/Allocations/AllocationsPage").then((m) => ({ default: m.AllocationsPage })));
const AnnouncementsPage = lazy(() => import("../pages/Announcements/AnnouncementsPage").then((m) => ({ default: m.AnnouncementsPage })));
const ApplicationsPage = lazy(() => import("../pages/Applications/ApplicationsPage").then((m) => ({ default: m.ApplicationsPage })));
const AuditLogsPage = lazy(() => import("../pages/AuditLogs/AuditLogsPage").then((m) => ({ default: m.AuditLogsPage })));
const BookingsPage = lazy(() => import("../pages/Bookings/BookingsPage").then((m) => ({ default: m.BookingsPage })));
const DashboardPage = lazy(() => import("../pages/Dashboard/DashboardPage").then((m) => ({ default: m.DashboardPage })));
const InternetAccessPage = lazy(() => import("../pages/InternetAccess/InternetAccessPage").then((m) => ({ default: m.InternetAccessPage })));
const MaintenancePage = lazy(() => import("../pages/Maintenance/MaintenancePage").then((m) => ({ default: m.MaintenancePage })));
const MessagesPage = lazy(() => import("../pages/Messages/MessagesPage").then((m) => ({ default: m.MessagesPage })));
const PaymentsPage = lazy(() => import("../pages/Payments/PaymentsPage").then((m) => ({ default: m.PaymentsPage })));
const RefundsPage = lazy(() => import("../pages/Refunds/RefundsPage").then((m) => ({ default: m.RefundsPage })));
const ReceiptsPage = lazy(() => import("../pages/Receipts/ReceiptsPage").then((m) => ({ default: m.ReceiptsPage })));
const ReportsPage = lazy(() => import("../pages/Reports/ReportsPage").then((m) => ({ default: m.ReportsPage })));
const ResidentsPage = lazy(() => import("../pages/Residents/ResidentsPage").then((m) => ({ default: m.ResidentsPage })));
const RoomsPage = lazy(() => import("../pages/Rooms/RoomsPage").then((m) => ({ default: m.RoomsPage })));
const SettingsPage = lazy(() => import("../pages/Settings/SettingsPage").then((m) => ({ default: m.SettingsPage })));
const SetupPage = lazy(() => import("../pages/Setup/SetupPage").then((m) => ({ default: m.SetupPage })));
const StaffPage = lazy(() => import("../pages/Staff/StaffPage").then((m) => ({ default: m.StaffPage })));

export function AppRoutes() {
  return (
    <Suspense fallback={<LoadingState label="Loading page..." />}>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route element={<ProtectedRoute />}>
          <Route path="/change-password" element={<ChangePasswordPage />} />
          <Route element={<AppShell />}>
            <Route index element={<Navigate to="/dashboard" replace />} />
            <Route path="/dashboard" element={<DashboardPage />} />
            <Route path="/residents" element={<ResidentsPage />} />
            <Route path="/applications" element={<ApplicationsPage />} />
            <Route path="/bookings" element={<BookingsPage />} />
            <Route path="/rooms" element={<RoomsPage />} />
            <Route path="/allocations" element={<AllocationsPage />} />
            <Route path="/payments" element={<RequirePermission permission="payment:read"><PaymentsPage /></RequirePermission>} />
            <Route path="/receipts" element={<RequirePermission permission="receipt:read"><ReceiptsPage /></RequirePermission>} />
            <Route path="/refunds" element={<RequirePermission permission="refund:read"><RefundsPage /></RequirePermission>} />
            <Route path="/internet-access" element={<RequirePermission permission="internet:read"><InternetAccessPage /></RequirePermission>} />
            <Route path="/maintenance" element={<MaintenancePage />} />
            <Route path="/announcements" element={<RequirePermission permission="announcement:read"><AnnouncementsPage /></RequirePermission>} />
            <Route path="/messages" element={<RequirePermission permission="message:read"><MessagesPage /></RequirePermission>} />
            <Route path="/reports" element={<RequirePermission permission="report:read"><ReportsPage /></RequirePermission>} />
            <Route path="/staff" element={<RequirePermission permission="staff:read"><StaffPage /></RequirePermission>} />
            <Route path="/setup" element={<RequirePermission permission="admin:write"><SetupPage /></RequirePermission>} />
            <Route path="/audit-logs" element={<RequirePermission permission="audit:read"><AuditLogsPage /></RequirePermission>} />
            <Route path="/settings" element={<RequirePermission permission="settings:read"><SettingsPage /></RequirePermission>} />
          </Route>
        </Route>
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Routes>
    </Suspense>
  );
}

import { Navigate, Route, Routes } from "react-router-dom";
import { ApplicationPage } from "../pages/Application/ApplicationPage";
import { BookingPage } from "../pages/Booking/BookingPage";
import { ResidentShell } from "../components/layout/ResidentShell";
import { DocumentsPage } from "../pages/Documents/DocumentsPage";
import { HomePage } from "../pages/Home/HomePage";
import { LoginPage } from "../pages/Login/LoginPage";
import { MaintenancePage } from "../pages/Maintenance/MaintenancePage";
import { PaymentsPage } from "../pages/Payments/PaymentsPage";
import { PlaceholderPage } from "../pages/Placeholder/PlaceholderPage";
import { ProfilePage } from "../pages/Profile/ProfilePage";
import { RegisterPage } from "../pages/Register/RegisterPage";
import { RoomPage } from "../pages/Room/RoomPage";
import { VerifyOtpPage } from "../pages/VerifyOtp/VerifyOtpPage";
import { ProtectedRoute } from "./ProtectedRoute";
import { RootRedirect } from "./RootRedirect";

const placeholders = [
  { path: "/messages", title: "Messages", description: "Resident portal message inbox support will appear here." },
  { path: "/announcements", title: "Announcements", description: "Published resident announcements will appear here." }
] as const;

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<RootRedirect />} />
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />
      <Route path="/verify-otp" element={<VerifyOtpPage />} />
      <Route element={<ProtectedRoute />}>
        <Route element={<ResidentShell />}>
          <Route path="/home" element={<HomePage />} />
          <Route path="/profile" element={<ProfilePage />} />
          <Route path="/documents" element={<DocumentsPage />} />
          <Route path="/application" element={<ApplicationPage />} />
          <Route path="/booking" element={<BookingPage />} />
          <Route path="/payments" element={<PaymentsPage />} />
          <Route path="/room" element={<RoomPage />} />
          <Route path="/maintenance" element={<MaintenancePage />} />
          {placeholders.map((route) => (
            <Route key={route.path} path={route.path} element={<PlaceholderPage title={route.title} description={route.description} />} />
          ))}
        </Route>
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

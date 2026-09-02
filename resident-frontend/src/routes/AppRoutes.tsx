import { Navigate, Route, Routes } from "react-router-dom";
import { ResidentShell } from "../components/layout/ResidentShell";
import { DocumentsPage } from "../pages/Documents/DocumentsPage";
import { HomePage } from "../pages/Home/HomePage";
import { LoginPage } from "../pages/Login/LoginPage";
import { PlaceholderPage } from "../pages/Placeholder/PlaceholderPage";
import { ProfilePage } from "../pages/Profile/ProfilePage";
import { RegisterPage } from "../pages/Register/RegisterPage";
import { VerifyOtpPage } from "../pages/VerifyOtp/VerifyOtpPage";
import { ProtectedRoute } from "./ProtectedRoute";
import { RootRedirect } from "./RootRedirect";

const placeholders = [
  { path: "/application", title: "Application", description: "The resident application workflow will appear here." },
  { path: "/booking", title: "Booking", description: "Your booking details and history will appear here." },
  { path: "/payments", title: "Payments", description: "Payment submission and history will appear here." },
  { path: "/room", title: "My Room", description: "Your active room and bed assignment will appear here." },
  { path: "/maintenance", title: "Maintenance", description: "Maintenance request creation and tracking will appear here." },
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
          {placeholders.map((route) => (
            <Route key={route.path} path={route.path} element={<PlaceholderPage title={route.title} description={route.description} />} />
          ))}
        </Route>
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

import { Navigate, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { SESSION_EXPIRED_KEY } from "../auth/sessionExpiry";
import { LoadingState } from "../components/common/LoadingState";

export function ProtectedRoute() {
  const { isAuthenticated, isLoading } = useAuth();
  const location = useLocation();

  if (isLoading) return <LoadingState label="Restoring your session" />;
  if (!isAuthenticated) {
    const sessionExpired = sessionStorage.getItem(SESSION_EXPIRED_KEY) === "1";
    return <Navigate to="/login" replace state={{ from: location, sessionExpired }} />;
  }
  return <Outlet />;
}

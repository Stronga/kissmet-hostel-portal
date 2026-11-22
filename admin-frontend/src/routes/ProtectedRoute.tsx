import { Navigate, Outlet, useLocation } from "react-router-dom";
import { LoadingState } from "../components/common/LoadingState";
import { useAuth } from "../auth/AuthContext";

export const CHANGE_PASSWORD_PATH = "/change-password";

export function ProtectedRoute() {
  const { user, isLoading } = useAuth();
  const location = useLocation();
  if (isLoading) return <LoadingState label="Restoring session..." fullScreen />;
  if (!user) return <Navigate to="/login" replace />;
  // Mandatory rotation: the backend blocks every other staff route, so the UI only offers this screen.
  if (user.mustChangePassword && location.pathname !== CHANGE_PASSWORD_PATH) return <Navigate to={CHANGE_PASSWORD_PATH} replace />;
  return <Outlet />;
}

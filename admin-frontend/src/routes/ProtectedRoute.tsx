import { Navigate, Outlet } from "react-router-dom";
import { LoadingState } from "../components/common/LoadingState";
import { useAuth } from "../auth/AuthContext";

export function ProtectedRoute() {
  const { user, isLoading } = useAuth();
  if (isLoading) return <LoadingState label="Restoring session..." fullScreen />;
  if (!user) return <Navigate to="/login" replace />;
  return <Outlet />;
}

import { Navigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { LoadingState } from "../components/common/LoadingState";

export function RootRedirect() {
  const { isAuthenticated, isLoading } = useAuth();
  if (isLoading) return <LoadingState label="Restoring your session" />;
  return <Navigate to={isAuthenticated ? "/home" : "/login"} replace />;
}

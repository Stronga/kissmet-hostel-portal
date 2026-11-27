import type { ReactNode } from "react";
import { hasPermission } from "../../auth/permissions";
import { useAuth } from "../../auth/AuthContext";
import { ErrorState } from "../common/ErrorState";
import { LoadingState } from "../common/LoadingState";

export function RequirePermission({ permission, children }: { permission: string; children: ReactNode }) {
  const { user, isLoading } = useAuth();
  if (isLoading) return <LoadingState label="Checking access..." />;
  if (!hasPermission(user?.role, permission)) {
    return <ErrorState title="Access denied" message="You do not have permission to view this page." />;
  }
  return children;
}

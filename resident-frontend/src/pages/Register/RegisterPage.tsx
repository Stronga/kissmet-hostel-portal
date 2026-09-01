import { Link, Navigate } from "react-router-dom";
import { Card } from "../../components/common/Card";
import { FormField } from "../../components/common/FormField";
import { Button } from "../../components/common/Button";
import { useAuth } from "../../auth/AuthContext";
import { usePageTitle } from "../../hooks/usePageTitle";

export function RegisterPage() {
  const { isAuthenticated } = useAuth();
  usePageTitle("Register");

  if (isAuthenticated) return <Navigate to="/home" replace />;

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-4 py-8">
      <Card className="w-full max-w-md">
        <h1 className="text-2xl font-semibold text-text-primary">Resident Registration</h1>
        <p className="mt-2 text-sm text-text-secondary">Registration and phone OTP verification will be connected in the next resident portal phase.</p>
        <div className="mt-6 space-y-4">
          <FormField label="Full name" disabled />
          <FormField label="Phone number" disabled />
          <FormField label="Institution" disabled />
          <FormField label="Student ID" disabled />
          <Button className="w-full" disabled>Start Registration</Button>
        </div>
        <Link to="/login" className="mt-5 inline-block text-sm font-semibold text-primary">Back to login</Link>
      </Card>
    </main>
  );
}

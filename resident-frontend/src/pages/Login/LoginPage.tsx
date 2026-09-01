import { Link, Navigate } from "react-router-dom";
import { Card } from "../../components/common/Card";
import { FormField } from "../../components/common/FormField";
import { Button } from "../../components/common/Button";
import { useAuth } from "../../auth/AuthContext";
import { usePageTitle } from "../../hooks/usePageTitle";

export function LoginPage() {
  const { isAuthenticated } = useAuth();
  usePageTitle("Login");

  if (isAuthenticated) return <Navigate to="/home" replace />;

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-4 py-8">
      <Card className="w-full max-w-md">
        <p className="text-xs font-semibold uppercase tracking-wide text-primary">Kissmet</p>
        <h1 className="mt-2 text-2xl font-semibold text-text-primary">Resident Portal</h1>
        <p className="mt-2 text-sm text-text-secondary">Resident login will use institution, student ID, and a phone OTP.</p>
        <div className="mt-6 space-y-4">
          <FormField label="Institution" placeholder="Select your institution" disabled />
          <FormField label="Student ID" placeholder="Enter your student ID" disabled />
          <Button className="w-full" disabled>Continue</Button>
        </div>
        <div className="mt-5 flex items-center justify-between text-sm">
          <Link to="/register" className="font-semibold text-primary">Register</Link>
          <Link to="/verify-otp" className="font-semibold text-primary">Verify OTP</Link>
        </div>
      </Card>
    </main>
  );
}

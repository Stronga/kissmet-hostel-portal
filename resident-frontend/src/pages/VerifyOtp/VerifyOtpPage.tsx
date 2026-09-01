import { Link, Navigate } from "react-router-dom";
import { Card } from "../../components/common/Card";
import { FormField } from "../../components/common/FormField";
import { Button } from "../../components/common/Button";
import { useAuth } from "../../auth/AuthContext";
import { usePageTitle } from "../../hooks/usePageTitle";

export function VerifyOtpPage() {
  const { isAuthenticated } = useAuth();
  usePageTitle("Verify OTP");

  if (isAuthenticated) return <Navigate to="/home" replace />;

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-4 py-8">
      <Card className="w-full max-w-md">
        <h1 className="text-2xl font-semibold text-text-primary">Verify OTP</h1>
        <p className="mt-2 text-sm text-text-secondary">OTP entry will be wired to the resident authentication backend in a later phase.</p>
        <div className="mt-6 space-y-4">
          <FormField label="One-time code" inputMode="numeric" disabled />
          <Button className="w-full" disabled>Verify</Button>
        </div>
        <Link to="/login" className="mt-5 inline-block text-sm font-semibold text-primary">Back to login</Link>
      </Card>
    </main>
  );
}

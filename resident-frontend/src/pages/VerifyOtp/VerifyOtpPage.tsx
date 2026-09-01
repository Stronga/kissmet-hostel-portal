import { FormEvent, useState } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { requestRegistrationOtp, requestResidentLoginOtp, verifyRegistrationOtp, verifyResidentLoginOtp } from "../../api/residentAuth";
import { Card } from "../../components/common/Card";
import { FormField } from "../../components/common/FormField";
import { Button } from "../../components/common/Button";
import { ErrorState } from "../../components/common/ErrorState";
import { useAuth } from "../../auth/AuthContext";
import { clearVerificationContext, loadVerificationContext, type VerificationContext } from "../../auth/verificationContext";
import { usePageTitle } from "../../hooks/usePageTitle";
import { safeAuthError } from "../../utils/errors";

export function VerifyOtpPage() {
  const { isAuthenticated, acceptSessionToken } = useAuth();
  const navigate = useNavigate();
  const [context] = useState<VerificationContext | null>(() => loadVerificationContext());
  const [otp, setOtp] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isResending, setIsResending] = useState(false);
  usePageTitle("Verify OTP");

  if (isAuthenticated) return <Navigate to="/home" replace />;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setNotice(null);
    if (!context) return;
    if (!otp.trim()) {
      setError("Verification code is required.");
      return;
    }
    setIsSubmitting(true);
    try {
      const input = { institutionCode: context.institutionCode, studentId: context.studentId, otp: otp.trim() };
      const result = context.flow === "login" ? await verifyResidentLoginOtp(input) : (await verifyRegistrationOtp(input)).data;
      await acceptSessionToken(result.token);
      clearVerificationContext();
      setOtp("");
      navigate("/home", { replace: true });
    } catch (error) {
      setError(safeAuthError(error));
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleResend() {
    if (!context) return;
    setError(null);
    setNotice(null);
    setIsResending(true);
    try {
      if (context.flow === "login") {
        await requestResidentLoginOtp({ institutionCode: context.institutionCode, studentId: context.studentId });
      } else if (context.registration) {
        await requestRegistrationOtp(context.registration);
      } else {
        throw new Error("Registration verification context is missing.");
      }
      setNotice("If verification can proceed, a new OTP has been sent.");
    } catch (error) {
      setError(safeAuthError(error));
    } finally {
      setIsResending(false);
    }
  }

  if (!context) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-background px-4 py-8">
        <Card className="w-full max-w-md">
          <h1 className="text-2xl font-semibold text-text-primary">Verify OTP</h1>
          <div className="mt-4">
            <ErrorState message="Verification details are no longer available. Please start again." />
          </div>
          <div className="mt-5 flex items-center justify-between text-sm">
            <Link to="/login" className="font-semibold text-primary">Back to login</Link>
            <Link to="/register" className="font-semibold text-primary">Register</Link>
          </div>
        </Card>
      </main>
    );
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-4 py-8">
      <Card className="w-full max-w-md">
        <h1 className="text-2xl font-semibold text-text-primary">Verify OTP</h1>
        <p className="mt-2 text-sm text-text-secondary">
          Enter the code sent to the registered phone for {context.institutionName} student ID {context.studentId}.
        </p>
        <form className="mt-6 space-y-4" onSubmit={handleSubmit}>
          <FormField
            label="Verification code"
            name="otp"
            value={otp}
            onChange={(event) => setOtp(event.currentTarget.value.replace(/\D/g, "").slice(0, 12))}
            inputMode="numeric"
            autoComplete="one-time-code"
            placeholder="Enter OTP"
            disabled={isSubmitting}
          />
          {notice ? <p className="rounded-token bg-muted p-3 text-sm text-text-secondary">{notice}</p> : null}
          {error ? <ErrorState message={error} /> : null}
          <Button className="w-full" type="submit" disabled={isSubmitting || isResending}>
            {isSubmitting ? "Verifying" : "Verify"}
          </Button>
        </form>
        <div className="mt-5 flex items-center justify-between text-sm">
          <button type="button" className="font-semibold text-primary disabled:opacity-60" disabled={isSubmitting || isResending} onClick={handleResend}>
            {isResending ? "Sending" : "Resend OTP"}
          </button>
          <Link to={context.flow === "registration" ? "/register" : "/login"} onClick={clearVerificationContext} className="font-semibold text-primary">
            Change details
          </Link>
        </div>
      </Card>
    </main>
  );
}

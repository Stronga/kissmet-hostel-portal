import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { Link, Navigate, useLocation, useNavigate } from "react-router-dom";
import { requestResidentLoginOtp } from "../../api/residentAuth";
import { Card } from "../../components/common/Card";
import { ErrorState } from "../../components/common/ErrorState";
import { FormField, SelectField } from "../../components/common/FormField";
import { Button } from "../../components/common/Button";
import { useAuth } from "../../auth/AuthContext";
import { consumeSessionExpiredFlag } from "../../auth/sessionExpiry";
import { loginContext, saveVerificationContext } from "../../auth/verificationContext";
import { useInstitutions } from "../../hooks/useInstitutions";
import { usePageTitle } from "../../hooks/usePageTitle";
import { safeAuthError } from "../../utils/errors";
import hostelIllustration from "../../assets/hostel-illustration.png";
import kissmetLogo from "../../assets/kissmet-logo.png";

export function LoginPage() {
  const { isAuthenticated } = useAuth();
  const { institutions, isLoading, error: institutionError } = useInstitutions();
  const navigate = useNavigate();
  const location = useLocation();
  const [institutionCode, setInstitutionCode] = useState("");
  const [studentId, setStudentId] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [sessionExpiredMessage] = useState(() => {
    const fromNav = Boolean((location.state as { sessionExpired?: boolean } | null)?.sessionExpired);
    const fromFlag = consumeSessionExpiredFlag();
    return fromNav || fromFlag ? "Your session expired. Please sign in again to continue." : null;
  });
  const submitLock = useRef(false);
  usePageTitle("Login");

  useEffect(() => {
    if ((location.state as { sessionExpired?: boolean } | null)?.sessionExpired) {
      navigate(location.pathname, { replace: true, state: null });
    }
  }, [location.pathname, location.state, navigate]);

  const options = useMemo(() => institutions.map((item) => ({ value: item.code, label: item.name })), [institutions]);

  if (isAuthenticated) return <Navigate to="/home" replace />;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitLock.current) return;
    const nextErrors: Record<string, string> = {};
    if (!institutionCode) nextErrors.institutionCode = "Institution is required.";
    if (!studentId.trim()) nextErrors.studentId = "Student ID is required.";
    setErrors(nextErrors);
    setSubmitError(null);
    if (Object.keys(nextErrors).length) return;

    submitLock.current = true;
    setIsSubmitting(true);
    try {
      const selected = institutions.find((item) => item.code === institutionCode);
      await requestResidentLoginOtp({ institutionCode, studentId: studentId.trim() });
      saveVerificationContext(loginContext({ institutionCode, studentId: studentId.trim() }, selected?.name ?? institutionCode));
      navigate("/verify-otp", { replace: false });
    } catch (error) {
      setSubmitError(safeAuthError(error));
    } finally {
      submitLock.current = false;
      setIsSubmitting(false);
    }
  }

  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-background px-4 py-8">
      <div
        className="pointer-events-none absolute bottom-0 left-0 z-0 h-[40vh] w-[85%] max-w-xl bg-contain bg-left-bottom bg-no-repeat opacity-90 sm:h-[55vh] sm:w-[65%] sm:max-w-2xl lg:h-[70vh] lg:w-[55%] lg:max-w-3xl"
        style={{ backgroundImage: `url(${hostelIllustration})` }}
        aria-hidden="true"
      />
      <div className="relative z-10 flex w-full max-w-md flex-col items-center gap-4">
        <img
          src={kissmetLogo}
          alt="Kissmet Hostel"
          className="h-16 w-auto object-contain sm:h-20"
        />
        <Card className="w-full">
        <h1 className="text-2xl font-semibold text-text-primary">Resident Portal</h1>
        <p className="mt-2 text-sm text-text-secondary">Sign in with your institution, student ID, and the OTP sent to your registered phone.</p>
        {sessionExpiredMessage ? (
          <div className="mt-4 rounded-token border border-warning/40 bg-amber-50 p-3 text-sm text-warning" role="status">
            {sessionExpiredMessage}
          </div>
        ) : null}
        {institutionError ? <div className="mt-4"><ErrorState message={institutionError} /></div> : null}
        <form className="mt-6 space-y-4" onSubmit={handleSubmit}>
          <SelectField
            label="Institution"
            name="institutionCode"
            value={institutionCode}
            onChange={(event) => setInstitutionCode(event.currentTarget.value)}
            options={options}
            disabled={isLoading || isSubmitting || Boolean(institutionError) || institutions.length === 0}
            hint={isLoading ? "Loading institutions" : institutions.length === 0 && !institutionError ? "No institutions are available." : undefined}
            error={errors.institutionCode}
          />
          <FormField
            label="Student ID"
            name="studentId"
            placeholder="Enter your student ID"
            value={studentId}
            onChange={(event) => setStudentId(event.currentTarget.value)}
            disabled={isSubmitting}
            autoComplete="username"
            error={errors.studentId}
          />
          {submitError ? <ErrorState message={submitError} /> : null}
          <Button className="w-full" type="submit" disabled={isSubmitting || isLoading || institutions.length === 0}>
            {isSubmitting ? "Sending OTP" : "Continue"}
          </Button>
        </form>
        <div className="mt-5 flex items-center justify-between text-sm">
          <Link to="/register" className="font-semibold text-primary">Register</Link>
          <Link to="/verify-otp" className="font-semibold text-primary">Enter OTP</Link>
        </div>
      </Card>
      </div>
    </main>
  );
}

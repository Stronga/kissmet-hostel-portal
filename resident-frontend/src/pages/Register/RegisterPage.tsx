import { FormEvent, useMemo, useRef, useState } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { requestRegistrationOtp, type RegistrationOtpInput } from "../../api/residentAuth";
import { Card } from "../../components/common/Card";
import { ErrorState } from "../../components/common/ErrorState";
import { FormField, SelectField } from "../../components/common/FormField";
import { Button } from "../../components/common/Button";
import { useAuth } from "../../auth/AuthContext";
import { registrationContext, saveVerificationContext } from "../../auth/verificationContext";
import { useInstitutions } from "../../hooks/useInstitutions";
import { usePageTitle } from "../../hooks/usePageTitle";
import { safeAuthError } from "../../utils/errors";
import hostelIllustration from "../../assets/hostel-illustration.png";
import kissmetLogo from "../../assets/kissmet-logo.png";

export function RegisterPage() {
  const { isAuthenticated } = useAuth();
  const { institutions, isLoading, error: institutionError } = useInstitutions();
  const navigate = useNavigate();
  const [residentKind, setResidentKind] = useState<"student" | "non_student">("student");
  const [form, setForm] = useState<RegistrationOtpInput>({
    firstName: "",
    middleName: "",
    lastName: "",
    phone: "",
    email: "",
    institutionCode: "",
    studentId: ""
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const submitLock = useRef(false);
  usePageTitle("Register");

  const options = useMemo(() => institutions.map((item) => ({ value: item.code, label: item.name })), [institutions]);

  if (isAuthenticated) return <Navigate to="/home" replace />;

  function updateField(name: keyof RegistrationOtpInput, value: string) {
    setForm((current) => ({ ...current, [name]: value }));
  }

  function validate() {
    const nextErrors: Record<string, string> = {};
    if (!form.firstName.trim()) nextErrors.firstName = "First name is required.";
    if (!form.lastName.trim()) nextErrors.lastName = "Last name is required.";
    if (!form.phone.trim()) nextErrors.phone = "Phone number is required.";
    if (form.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) nextErrors.email = "Enter a valid email address.";
    if (!form.institutionCode) nextErrors.institutionCode = "Institution is required.";
    if (!form.studentId.trim()) nextErrors.studentId = "Student ID is required.";
    return nextErrors;
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitLock.current) return;
    const nextErrors = validate();
    setErrors(nextErrors);
    setSubmitError(null);
    if (Object.keys(nextErrors).length) return;

    const payload: RegistrationOtpInput = {
      firstName: form.firstName.trim(),
      middleName: form.middleName?.trim() || null,
      lastName: form.lastName.trim(),
      phone: form.phone.trim(),
      email: form.email?.trim() || null,
      institutionCode: form.institutionCode,
      studentId: form.studentId.trim()
    };

    submitLock.current = true;
    setIsSubmitting(true);
    try {
      const selected = institutions.find((item) => item.code === payload.institutionCode);
      await requestRegistrationOtp(payload);
      saveVerificationContext(registrationContext(payload, selected?.name ?? payload.institutionCode));
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
      <div className="relative z-10 flex w-full max-w-2xl flex-col items-center gap-4">
        <img
          src={kissmetLogo}
          alt="Kissmet Hostel"
          className="h-16 w-auto object-contain sm:h-20"
        />
        <Card className="w-full">
        <h1 className="text-2xl font-semibold text-text-primary">Resident Registration</h1>
        <p className="mt-2 text-sm text-text-secondary">Student self-registration verifies the phone number attached to your institution and student ID. Non-student self-registration is not available yet.</p>
        <div className="mt-4">
          <SelectField
            label="Resident Type"
            name="residentKind"
            value={residentKind}
            onChange={(event) => setResidentKind(event.currentTarget.value as "student" | "non_student")}
            options={[{ value: "student", label: "Student" }, { value: "non_student", label: "Non-Student" }]}
            disabled={isSubmitting}
          />
        </div>
        {residentKind === "non_student" ? (
          <div className="mt-4 rounded-2xl border border-border bg-muted p-4 text-sm text-text-secondary" role="status">
            Non-student self-registration and login are deferred until the phone / resident-code OTP auth migration. Ask Kissmet admin staff to provision a Non-Student resident locally. Do not use a temporary insecure login workaround.
          </div>
        ) : null}
        {institutionError ? <div className="mt-4"><ErrorState message={institutionError} /></div> : null}
        <form className="mt-6 grid gap-4 sm:grid-cols-2" onSubmit={handleSubmit}>
          <fieldset disabled={residentKind === "non_student"} className="contents">
          <FormField label="First name" name="firstName" value={form.firstName} onChange={(event) => updateField("firstName", event.currentTarget.value)} disabled={isSubmitting || residentKind === "non_student"} error={errors.firstName} autoComplete="given-name" />
          <FormField label="Middle name" name="middleName" value={form.middleName ?? ""} onChange={(event) => updateField("middleName", event.currentTarget.value)} disabled={isSubmitting || residentKind === "non_student"} autoComplete="additional-name" />
          <FormField label="Last name" name="lastName" value={form.lastName} onChange={(event) => updateField("lastName", event.currentTarget.value)} disabled={isSubmitting || residentKind === "non_student"} error={errors.lastName} autoComplete="family-name" />
          <FormField label="Phone number" name="phone" value={form.phone} onChange={(event) => updateField("phone", event.currentTarget.value)} disabled={isSubmitting || residentKind === "non_student"} error={errors.phone} autoComplete="tel" inputMode="tel" />
          <FormField label="Email" name="email" value={form.email ?? ""} onChange={(event) => updateField("email", event.currentTarget.value)} disabled={isSubmitting || residentKind === "non_student"} error={errors.email} autoComplete="email" inputMode="email" />
          <FormField label="Student ID" name="studentId" value={form.studentId} onChange={(event) => updateField("studentId", event.currentTarget.value)} disabled={isSubmitting || residentKind === "non_student"} error={errors.studentId} autoComplete="username" />
          <div className="sm:col-span-2">
            <SelectField
              label="Institution"
              name="institutionCode"
              value={form.institutionCode}
              onChange={(event) => updateField("institutionCode", event.currentTarget.value)}
              options={options}
              disabled={isLoading || isSubmitting || residentKind === "non_student" || Boolean(institutionError) || institutions.length === 0}
              hint={isLoading ? "Loading institutions" : institutions.length === 0 && !institutionError ? "No institutions are available." : undefined}
              error={errors.institutionCode}
            />
          </div>
          </fieldset>
          {submitError ? <div className="sm:col-span-2"><ErrorState message={submitError} /></div> : null}
          <div className="sm:col-span-2">
            <Button className="w-full" type="submit" disabled={residentKind === "non_student" || isSubmitting || isLoading || institutions.length === 0}>
              {residentKind === "non_student" ? "Non-student registration unavailable" : isSubmitting ? "Sending OTP" : "Start Registration"}
            </Button>
          </div>
        </form>
        <Link to="/login" className="mt-5 inline-block text-sm font-semibold text-primary">Back to login</Link>
      </Card>
      </div>
    </main>
  );
}

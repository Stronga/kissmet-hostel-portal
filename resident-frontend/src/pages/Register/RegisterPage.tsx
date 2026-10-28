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

const OTHER_INSTITUTION = "__other__";

export function RegisterPage() {
  const { isAuthenticated } = useAuth();
  const { institutions, isLoading, error: institutionError } = useInstitutions();
  const navigate = useNavigate();
  const [form, setForm] = useState<RegistrationOtpInput & { ghanaCardNumber?: string }>({
    firstName: "",
    middleName: "",
    lastName: "",
    phone: "",
    email: "",
    institutionCode: "",
    studentId: "",
    ghanaCardNumber: ""
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const submitLock = useRef(false);
  usePageTitle("Register");

  const isOther = form.institutionCode === OTHER_INSTITUTION;
  const options = useMemo(
    () => [
      ...institutions.map((item) => ({ value: item.code, label: item.name })),
      { value: OTHER_INSTITUTION, label: "Other" }
    ],
    [institutions]
  );

  if (isAuthenticated) return <Navigate to="/home" replace />;

  function updateField(name: keyof typeof form, value: string) {
    setForm((current) => ({ ...current, [name]: value }));
  }

  function validate() {
    const nextErrors: Record<string, string> = {};
    if (!form.firstName.trim()) nextErrors.firstName = "First name is required.";
    if (!form.lastName.trim()) nextErrors.lastName = "Last name is required.";
    if (!form.phone.trim()) nextErrors.phone = "Phone number is required.";
    if (form.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) nextErrors.email = "Enter a valid email address.";
    if (!form.institutionCode) nextErrors.institutionCode = "Institution is required.";
    if (!isOther && !form.studentId.trim()) nextErrors.studentId = "Student ID / School Number is required.";
    if (isOther && !form.ghanaCardNumber?.trim()) nextErrors.ghanaCardNumber = "Ghana Card Number is required.";
    return nextErrors;
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitLock.current || isOther) return;
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
        <p className="mt-2 text-sm text-text-secondary">
          Choose your institution. Listed institutions verify phone with Student ID / School Number.
          Other uses Ghana Card Number; self-service login for Other is not available yet.
        </p>
        {institutionError ? <div className="mt-4"><ErrorState message={institutionError} /></div> : null}
        <form className="mt-6 grid gap-4 sm:grid-cols-2" onSubmit={handleSubmit}>
          <FormField label="First name" name="firstName" value={form.firstName} onChange={(event) => updateField("firstName", event.currentTarget.value)} disabled={isSubmitting} error={errors.firstName} autoComplete="given-name" />
          <FormField label="Middle name" name="middleName" value={form.middleName ?? ""} onChange={(event) => updateField("middleName", event.currentTarget.value)} disabled={isSubmitting} autoComplete="additional-name" />
          <FormField label="Last name" name="lastName" value={form.lastName} onChange={(event) => updateField("lastName", event.currentTarget.value)} disabled={isSubmitting} error={errors.lastName} autoComplete="family-name" />
          <FormField label="Phone number" name="phone" value={form.phone} onChange={(event) => updateField("phone", event.currentTarget.value)} disabled={isSubmitting} error={errors.phone} autoComplete="tel" inputMode="tel" />
          <FormField label="Email" name="email" value={form.email ?? ""} onChange={(event) => updateField("email", event.currentTarget.value)} disabled={isSubmitting} error={errors.email} autoComplete="email" inputMode="email" />
          <div className="sm:col-span-2">
            <SelectField
              label="Institution"
              name="institutionCode"
              value={form.institutionCode}
              onChange={(event) => {
                const value = event.currentTarget.value;
                setForm((current) => ({
                  ...current,
                  institutionCode: value,
                  studentId: value === OTHER_INSTITUTION ? "" : current.studentId,
                  ghanaCardNumber: value === OTHER_INSTITUTION ? current.ghanaCardNumber : ""
                }));
              }}
              options={options}
              disabled={isLoading || isSubmitting || Boolean(institutionError) || institutions.length === 0}
              hint={isLoading ? "Loading institutions" : institutions.length === 0 && !institutionError ? "No institutions are available." : undefined}
              error={errors.institutionCode}
            />
          </div>
          {isOther ? (
            <div className="sm:col-span-2">
              <FormField
                label="Ghana Card Number"
                name="ghanaCardNumber"
                value={form.ghanaCardNumber ?? ""}
                onChange={(event) => updateField("ghanaCardNumber", event.currentTarget.value)}
                disabled={isSubmitting}
                error={errors.ghanaCardNumber}
                autoComplete="off"
              />
            </div>
          ) : (
            <FormField
              label="Student ID / School Number"
              name="studentId"
              value={form.studentId}
              onChange={(event) => updateField("studentId", event.currentTarget.value)}
              disabled={isSubmitting || !form.institutionCode}
              error={errors.studentId}
              autoComplete="username"
            />
          )}
          {isOther ? (
            <div className="sm:col-span-2 rounded-2xl border border-border bg-muted p-4 text-sm text-text-secondary" role="status">
              Other self-registration and login are deferred until the phone / resident-code OTP auth migration.
              Ask Kissmet admin staff to provision your resident record. Ghana Card Number is not a password and cannot be used to log in yet.
            </div>
          ) : null}
          {submitError ? <div className="sm:col-span-2"><ErrorState message={submitError} /></div> : null}
          <div className="sm:col-span-2">
            <Button className="w-full" type="submit" disabled={isOther || isSubmitting || isLoading || institutions.length === 0}>
              {isOther ? "Other registration unavailable" : isSubmitting ? "Sending OTP" : "Start Registration"}
            </Button>
          </div>
        </form>
        <Link to="/login" className="mt-5 inline-block text-sm font-semibold text-primary">Back to login</Link>
      </Card>
      </div>
    </main>
  );
}

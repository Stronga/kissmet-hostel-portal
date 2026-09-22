import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "../../components/common/Button";
import { Card } from "../../components/common/Card";
import { Detail } from "../../components/common/Detail";
import { EmptyState } from "../../components/common/EmptyState";
import { ErrorState } from "../../components/common/ErrorState";
import { InfoHelp } from "../../components/common/InfoHelp";
import { LoadingState } from "../../components/common/LoadingState";
import { StatusBadge } from "../../components/common/StatusBadge";
import { PageHeader } from "../../components/layout/PageHeader";
import { createResidentPayment, fetchResidentPaymentSummary, fetchResidentPayments, fetchResidentReceipts, submitResidentPayment, uploadResidentPaymentSlip } from "../../api/resident";
import { usePageTitle } from "../../hooks/usePageTitle";
import type { ResidentPayment, ResidentPaymentSummary, ResidentReceipt } from "../../types/resident";
import { formatDateTime, formatMoneyMinor } from "../../utils/format";
import { methodLabel, parseGhsMinor, paymentMethods, paymentStatusLabel, validatePaymentAmount, validatePaymentSlip } from "../../utils/payments";

interface PaymentsData {
  summary: ResidentPaymentSummary | null;
  payments: ResidentPayment[];
  receipts: ResidentReceipt[];
}

function SummaryMetric({
  label,
  value,
  help,
  helpLabel
}: {
  label: string;
  value: string;
  help?: string;
  helpLabel?: string;
}) {
  return (
    <div className="rounded-2xl border border-border bg-[#f7f9fa] p-4">
      <p className="inline-flex items-center gap-1 text-xs font-semibold uppercase tracking-wide text-text-secondary">
        <span>{label}</span>
        {help && helpLabel ? <InfoHelp label={helpLabel}>{help}</InfoHelp> : null}
      </p>
      <p className="mt-2 break-words text-xl font-bold text-text-primary">{value}</p>
    </div>
  );
}

export function PaymentsPage() {
  const [data, setData] = useState<PaymentsData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState("mobile_money");
  const [notes, setNotes] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const inFlight = useRef<string | null>(null);
  usePageTitle("Payments");

  async function load() {
    setIsLoading(true);
    setError(null);
    try {
      const [summary, payments, receipts] = await Promise.all([
        fetchResidentPaymentSummary(),
        fetchResidentPayments(),
        fetchResidentReceipts()
      ]);
      setData({ summary: summary.data, payments: payments.data, receipts: receipts.data });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load payments.");
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => { void load(); }, []);

  const currentBookingId = data?.summary?.bookingId ?? null;
  const amountError = useMemo(() => validatePaymentAmount(amount, data?.summary?.outstandingMinor), [amount, data?.summary?.outstandingMinor]);

  async function runAction(key: string, action: () => Promise<void>) {
    if (inFlight.current) return;
    inFlight.current = key;
    setBusyKey(key);
    setActionError(null);
    setActionSuccess(null);
    try {
      await action();
      await load();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Request failed.");
    } finally {
      inFlight.current = null;
      setBusyKey(null);
    }
  }

  async function createPayment() {
    if (!currentBookingId || amountError) {
      setActionError(amountError ?? "No current booking is available for payment.");
      return;
    }
    await runAction("create", async () => {
      await createResidentPayment({ bookingId: currentBookingId, amountMinor: parseGhsMinor(amount)!, currency: data!.summary!.currency, method, notes: notes || null });
      setAmount("");
      setNotes("");
      setActionSuccess("Payment record created.");
    });
  }

  async function uploadSlip(payment: ResidentPayment, file: File | null) {
    const slipError = validatePaymentSlip(file);
    if (slipError) {
      setActionError(slipError);
      return;
    }
    await runAction(`slip-${payment.id}`, async () => {
      await uploadResidentPaymentSlip(payment.id, file!);
      setActionSuccess("Payment slip uploaded.");
    });
  }

  async function submitPayment(payment: ResidentPayment) {
    if (!window.confirm("Submit this payment for staff verification?")) return;
    await runAction(`submit-${payment.id}`, async () => {
      await submitResidentPayment(payment.id);
      setActionSuccess("Payment submitted for verification.");
    });
  }

  if (isLoading) return <LoadingState label="Loading payments" />;
  if (error || !data) {
    return <ErrorState title="Payments unavailable" message={error ?? "Unable to load payments."} onRetry={() => void load()} />;
  }

  return (
    <>
      <PageHeader title="Payments" description="Submit payments and slips for staff verification." />
      {actionError ? <div className="mb-5"><ErrorState title="Payment action failed" message={actionError} /></div> : null}
      {actionSuccess ? <div className="mb-5 rounded-2xl border border-success/30 bg-success/5 p-4 text-sm font-semibold text-success">{actionSuccess}</div> : null}

      {data.summary ? (
        <Card>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <p className="text-sm font-semibold text-text-secondary">Current booking</p>
              <h2 className="mt-1 break-words text-xl font-bold text-text-primary">{data.summary.bookingNumber}</h2>
            </div>
            <StatusBadge status={data.summary.bookingStatus} />
          </div>
          {data.summary.paymentAttentionRequired ? (
            <div className="mt-5 rounded-2xl border border-danger/30 bg-danger/5 p-4 text-sm text-text-primary" role="alert">
              <p className="font-semibold text-danger">Payment attention required</p>
              <p className="mt-1">{data.summary.paymentAttentionReason || "This booking needs payment review."}</p>
            </div>
          ) : null}
          <div className="mt-5 grid gap-3 sm:grid-cols-3">
            <SummaryMetric
              label="Booking total"
              value={formatMoneyMinor(data.summary.bookingTotalMinor, data.summary.currency)}
            />
            <SummaryMetric
              label="Verified"
              value={formatMoneyMinor(data.summary.verifiedTotalMinor, data.summary.currency)}
              helpLabel="About verified payment"
              help="Outstanding balance uses verified payments only. Uploading a slip or submitting a payment does not verify it."
            />
            <SummaryMetric
              label="Outstanding"
              value={formatMoneyMinor(data.summary.outstandingMinor, data.summary.currency)}
              helpLabel="About outstanding balance"
              help="Outstanding balance uses verified payments only. Meeting the confirmation threshold does not auto-confirm the booking."
            />
          </div>
          <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <Detail label="Pending verification" value={formatMoneyMinor(data.summary.submittedTotalMinor, data.summary.currency)} />
            <Detail label="Draft/pending payments" value={formatMoneyMinor(data.summary.pendingTotalMinor, data.summary.currency)} />
            <Detail label="Refunded" value={formatMoneyMinor(data.summary.refundedTotalMinor, data.summary.currency)} />
            <Detail
              label="Required before confirmation"
              value={formatMoneyMinor(data.summary.requiredConfirmationAmountMinor, data.summary.currency)}
              help={
                <InfoHelp label="About confirmation requirement">
                  Meeting the confirmation threshold does not auto-confirm the booking. Staff still confirm separately.
                </InfoHelp>
              }
            />
            <Detail label="Still needed for eligibility" value={formatMoneyMinor(data.summary.remainingToConfirmationMinor, data.summary.currency)} />
          </div>
          {data.summary.confirmationRequirementMet && data.summary.bookingStatus === "pending" ? (
            <p className="mt-4 rounded-2xl border border-border bg-muted p-3 text-sm font-semibold text-text-primary">
              Payment requirement met - awaiting staff booking confirmation.
            </p>
          ) : null}
        </Card>
      ) : (
        <Card>
          <EmptyState title="No current booking" message="Payment cannot be made until a current booking exists." actionHref="/booking" actionLabel="View booking" />
        </Card>
      )}

      <div className="mt-5 grid gap-5 lg:grid-cols-[0.85fr_1.15fr]">
        <Card>
          <h2 className="text-lg font-bold text-text-primary">Make payment</h2>
          {data.summary ? (
            <div className="mt-4 space-y-4">
              <label className="block text-sm font-semibold text-text-primary" htmlFor="payment-amount">Amount in GHS</label>
              <input id="payment-amount" className="min-h-11 w-full rounded-xl border border-border px-3 py-3 text-sm" value={amount} onChange={(event) => setAmount(event.currentTarget.value)} placeholder="0.00" inputMode="decimal" autoComplete="transaction-amount" disabled={Boolean(busyKey)} />
              {amount && amountError ? <p className="text-sm font-semibold text-danger" role="alert">{amountError}</p> : null}
              <label className="block text-sm font-semibold text-text-primary" htmlFor="payment-method">Payment method</label>
              <select id="payment-method" className="min-h-11 w-full rounded-xl border border-border px-3 py-3 text-sm" value={method} onChange={(event) => setMethod(event.currentTarget.value)} disabled={Boolean(busyKey)}>
                {paymentMethods.map((item) => <option key={item} value={item}>{methodLabel(item)}</option>)}
              </select>
              <label className="block text-sm font-semibold text-text-primary" htmlFor="payment-notes">Reference note</label>
              <textarea id="payment-notes" className="min-h-24 w-full rounded-xl border border-border px-3 py-3 text-sm" value={notes} onChange={(event) => setNotes(event.currentTarget.value)} disabled={Boolean(busyKey)} autoComplete="off" />
              <Button className="w-full rounded-full" disabled={busyKey === "create" || Boolean(amount && amountError)} onClick={() => void createPayment()}>{busyKey === "create" ? "Creating..." : "Create payment record"}</Button>
              <p className="inline-flex items-start gap-1 text-xs text-text-secondary">
                <span>Payment references are generated by Kissmet.</span>
                <InfoHelp label="About payment submission terms">
                  Upload does not mean verified. Meeting the payment threshold does not automatically confirm the booking.
                </InfoHelp>
              </p>
            </div>
          ) : (
            <EmptyState title="Booking required" message="A payment record can be created only after a current booking exists." />
          )}
        </Card>

        <Card>
          <h2 className="text-lg font-bold text-text-primary">Payment history</h2>
          {data.payments.length ? (
            <div className="mt-4 space-y-3">
              {data.payments.map((payment) => (
                <div key={payment.id} className="rounded-token rounded-xl border border-border bg-white p-4">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                      <p className="break-words text-sm font-semibold text-text-primary">{payment.payment_reference}</p>
                      <p className="mt-1 text-sm text-text-secondary">{formatMoneyMinor(payment.amount_minor, payment.currency)} via {methodLabel(payment.method)}</p>
                    </div>
                    <span className="inline-flex items-center gap-1">
                      <StatusBadge status={paymentStatusLabel(payment.status)} />
                      <InfoHelp label="About payment status">
                        Staff verification is required before a payment counts toward your outstanding balance.
                      </InfoHelp>
                    </span>
                  </div>
                  <div className="mt-4 grid gap-3 sm:grid-cols-3">
                    <Detail label="Created" value={formatDateTime(payment.created_at)} />
                    <Detail label="Submitted" value={formatDateTime(payment.submitted_at)} />
                    <Detail label="Verified" value={formatDateTime(payment.verified_at)} />
                  </div>
                  <div className="mt-4 rounded-xl border border-border bg-[#f7f9fa] p-3 text-sm text-text-secondary">
                    <p><span className="font-semibold text-text-primary">Payment slip:</span> {payment.slip_filename ?? "Not uploaded"}</p>
                    <p className="mt-1 inline-flex items-center gap-1">
                      Private slip viewing is not exposed by the current resident backend.
                      <InfoHelp label="About payment slips">
                        Slips are stored privately. No public storage URL is shown in the resident portal.
                      </InfoHelp>
                    </p>
                  </div>
                  {payment.status === "pending" || payment.status === "submitted" ? (
                    <div className="mt-4 flex flex-col gap-2 sm:flex-row">
                      <label className="inline-flex min-h-11 cursor-pointer items-center justify-center rounded-full border border-border bg-surface px-4 py-2 text-sm font-semibold text-text-primary">
                        Upload slip
                        <input className="sr-only" type="file" accept="application/pdf,image/jpeg,image/png,image/webp" onChange={(event) => void uploadSlip(payment, event.currentTarget.files?.[0] ?? null)} />
                      </label>
                      {payment.status === "pending" ? <Button className="rounded-full" disabled={busyKey === `submit-${payment.id}`} onClick={() => void submitPayment(payment)}>{busyKey === `submit-${payment.id}` ? "Submitting..." : "Submit for verification"}</Button> : null}
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          ) : (
            <EmptyState title="No payments yet" message="Created payment records will appear here." />
          )}
        </Card>
      </div>

      <Card className="mt-5">
        <h2 className="inline-flex items-center gap-1 text-lg font-bold text-text-primary">
          Receipts
          <InfoHelp label="About receipts">
            Receipts are issued for verified payments. The resident portal does not issue or void receipts.
          </InfoHelp>
        </h2>
        {data.receipts.length ? (
          <div className="mt-4 space-y-3">
            {data.receipts.map((receipt) => (
              <div key={receipt.id} className="rounded-xl border border-border bg-white p-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <p className="break-words text-sm font-semibold text-text-primary">{receipt.receipt_number}</p>
                    <p className="mt-1 text-sm text-text-secondary">{receipt.payment_reference} - {formatMoneyMinor(receipt.amount_minor, receipt.currency)}</p>
                    <p className="mt-1 text-[13px] text-text-secondary">Issued {formatDateTime(receipt.issued_at)}</p>
                  </div>
                  <StatusBadge status={receipt.status} />
                </div>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState title="No receipts yet" message="Issued receipts for verified payments will appear here." />
        )}
      </Card>
    </>
  );
}

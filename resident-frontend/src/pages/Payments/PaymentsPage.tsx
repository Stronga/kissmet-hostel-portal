import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "../../components/common/Button";
import { Card } from "../../components/common/Card";
import { EmptyState } from "../../components/common/EmptyState";
import { ErrorState } from "../../components/common/ErrorState";
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

function Detail({ label, value }: { label: string; value?: string | number | null }) {
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-wide text-text-secondary">{label}</p>
      <p className="mt-1 text-sm font-semibold text-text-primary">{value || "Unavailable"}</p>
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
    return (
      <div className="space-y-4">
        <ErrorState title="Payments unavailable" message={error ?? "Unable to load payments."} />
        <Button onClick={() => void load()}>Retry</Button>
      </div>
    );
  }

  return (
    <>
      <PageHeader title="Payments" description="Submit payment records and private payment slips for staff verification." />
      {actionError ? <div className="mb-5"><ErrorState title="Payment action failed" message={actionError} /></div> : null}
      {actionSuccess ? <div className="mb-5 rounded-token border border-success/30 bg-success/5 p-4 text-sm font-semibold text-success">{actionSuccess}</div> : null}

      {data.summary ? (
        <Card>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <p className="text-sm font-semibold text-text-secondary">Current booking</p>
              <h2 className="mt-1 text-xl font-semibold text-text-primary">{data.summary.bookingNumber}</h2>
              <p className="mt-1 text-sm text-text-secondary">Outstanding balance is based on verified payments only.</p>
            </div>
            <StatusBadge status={data.summary.bookingStatus} />
          </div>
          {data.summary.paymentAttentionRequired ? (
            <div className="mt-5 rounded-token border border-danger/30 bg-danger/5 p-4 text-sm text-text-primary" role="alert">
              <p className="font-semibold text-danger">Payment attention required</p>
              <p className="mt-1">{data.summary.paymentAttentionReason || "This booking needs payment review."}</p>
            </div>
          ) : null}
          <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Detail label="Booking total" value={formatMoneyMinor(data.summary.bookingTotalMinor, data.summary.currency)} />
            <Detail label="Verified total" value={formatMoneyMinor(data.summary.verifiedTotalMinor, data.summary.currency)} />
            <Detail label="Outstanding" value={formatMoneyMinor(data.summary.outstandingMinor, data.summary.currency)} />
            <Detail label="Pending verification" value={formatMoneyMinor(data.summary.submittedTotalMinor, data.summary.currency)} />
            <Detail label="Draft/pending payments" value={formatMoneyMinor(data.summary.pendingTotalMinor, data.summary.currency)} />
            <Detail label="Refunded" value={formatMoneyMinor(data.summary.refundedTotalMinor, data.summary.currency)} />
            <Detail label="Required before confirmation" value={formatMoneyMinor(data.summary.requiredConfirmationAmountMinor, data.summary.currency)} />
            <Detail label="Still needed for eligibility" value={formatMoneyMinor(data.summary.remainingToConfirmationMinor, data.summary.currency)} />
          </div>
          {data.summary.confirmationRequirementMet && data.summary.bookingStatus === "pending" ? (
            <p className="mt-4 rounded-token border border-border bg-muted p-3 text-sm font-semibold text-text-primary">Payment requirement met - awaiting staff booking confirmation.</p>
          ) : null}
        </Card>
      ) : (
        <Card>
          <EmptyState title="No current booking" message="Payment cannot be made until a current booking exists." />
        </Card>
      )}

      <div className="mt-5 grid gap-4 lg:grid-cols-[0.85fr_1.15fr]">
        <Card>
          <h2 className="text-lg font-semibold text-text-primary">Make payment</h2>
          {data.summary ? (
            <div className="mt-4 space-y-4">
              <label className="block text-sm font-semibold text-text-primary" htmlFor="payment-amount">Amount in GHS</label>
              <input id="payment-amount" className="w-full rounded-token border border-border px-3 py-3 text-sm" value={amount} onChange={(event) => setAmount(event.currentTarget.value)} placeholder="0.00" />
              {amount && amountError ? <p className="text-sm font-semibold text-danger" role="alert">{amountError}</p> : null}
              <label className="block text-sm font-semibold text-text-primary" htmlFor="payment-method">Payment method</label>
              <select id="payment-method" className="w-full rounded-token border border-border px-3 py-3 text-sm" value={method} onChange={(event) => setMethod(event.currentTarget.value)}>
                {paymentMethods.map((item) => <option key={item} value={item}>{methodLabel(item)}</option>)}
              </select>
              <label className="block text-sm font-semibold text-text-primary" htmlFor="payment-notes">Reference note</label>
              <textarea id="payment-notes" className="min-h-24 w-full rounded-token border border-border px-3 py-3 text-sm" value={notes} onChange={(event) => setNotes(event.currentTarget.value)} />
              <Button className="w-full" disabled={busyKey === "create" || Boolean(amount && amountError)} onClick={() => void createPayment()}>{busyKey === "create" ? "Creating..." : "Create payment record"}</Button>
              <p className="text-xs text-text-secondary">Payment references are generated by Kissmet. Submission does not verify payment or confirm booking.</p>
            </div>
          ) : (
            <EmptyState title="Booking required" message="A payment record can be created only after a current booking exists." />
          )}
        </Card>

        <Card>
          <h2 className="text-lg font-semibold text-text-primary">Payment history</h2>
          {data.payments.length ? (
            <div className="mt-4 space-y-3">
              {data.payments.map((payment) => (
                <div key={payment.id} className="rounded-token border border-border bg-white p-4">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <p className="text-sm font-semibold text-text-primary">{payment.payment_reference}</p>
                      <p className="mt-1 text-sm text-text-secondary">{formatMoneyMinor(payment.amount_minor, payment.currency)} via {methodLabel(payment.method)}</p>
                    </div>
                    <StatusBadge status={paymentStatusLabel(payment.status)} />
                  </div>
                  <div className="mt-4 grid gap-3 sm:grid-cols-3">
                    <Detail label="Created" value={formatDateTime(payment.created_at)} />
                    <Detail label="Submitted" value={formatDateTime(payment.submitted_at)} />
                    <Detail label="Verified" value={formatDateTime(payment.verified_at)} />
                  </div>
                  <div className="mt-4 rounded-token border border-border bg-muted/50 p-3 text-sm text-text-secondary">
                    <p><span className="font-semibold text-text-primary">Payment slip:</span> {payment.slip_filename ?? "Not uploaded"}</p>
                    <p className="mt-1">Private slip viewing is not exposed by the current resident backend.</p>
                  </div>
                  {payment.status === "pending" || payment.status === "submitted" ? (
                    <div className="mt-4 flex flex-col gap-2 sm:flex-row">
                      <label className="inline-flex min-h-11 cursor-pointer items-center justify-center rounded-token border border-border bg-surface px-4 py-2 text-sm font-semibold text-text-primary">
                        Upload slip
                        <input className="sr-only" type="file" accept="application/pdf,image/jpeg,image/png,image/webp" onChange={(event) => void uploadSlip(payment, event.currentTarget.files?.[0] ?? null)} />
                      </label>
                      {payment.status === "pending" ? <Button disabled={busyKey === `submit-${payment.id}`} onClick={() => void submitPayment(payment)}>{busyKey === `submit-${payment.id}` ? "Submitting..." : "Submit for verification"}</Button> : null}
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
        <h2 className="text-lg font-semibold text-text-primary">Receipts</h2>
        {data.receipts.length ? (
          <div className="mt-4 space-y-3">
            {data.receipts.map((receipt) => (
              <div key={receipt.id} className="rounded-token border border-border bg-white p-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <p className="text-sm font-semibold text-text-primary">{receipt.receipt_number}</p>
                    <p className="mt-1 text-sm text-text-secondary">{receipt.payment_reference} - {formatMoneyMinor(receipt.amount_minor, receipt.currency)}</p>
                    <p className="mt-1 text-sm text-text-secondary">Issued {formatDateTime(receipt.issued_at)}</p>
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

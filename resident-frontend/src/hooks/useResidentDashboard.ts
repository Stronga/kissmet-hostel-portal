import { useCallback, useEffect, useState } from "react";
import { ApiError } from "../api/client";
import { fetchResidentAllocation, fetchResidentApplications, fetchResidentBookings, fetchResidentDocuments, fetchResidentPaymentSummary, fetchResidentProfile } from "../api/resident";
import type { DashboardData } from "../types/resident";

function message(error: unknown) {
  return error instanceof ApiError ? error.message : "Unable to load this information.";
}

export function useResidentDashboard() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const profile = (await fetchResidentProfile()).data;
      if (!profile?.first_name || !profile?.last_name || !profile?.resident_code) {
        throw new Error("Resident profile is unavailable.");
      }
      const [documents, applications, bookings, allocation, paymentSummary] = await Promise.allSettled([
        fetchResidentDocuments(),
        fetchResidentApplications(),
        fetchResidentBookings(),
        fetchResidentAllocation(),
        fetchResidentPaymentSummary()
      ]);
      const partialErrors: string[] = [];
      if (documents.status === "rejected") partialErrors.push(`Documents: ${message(documents.reason)}`);
      if (applications.status === "rejected") partialErrors.push(`Applications: ${message(applications.reason)}`);
      if (bookings.status === "rejected") partialErrors.push(`Bookings: ${message(bookings.reason)}`);
      if (allocation.status === "rejected") partialErrors.push(`Room assignment: ${message(allocation.reason)}`);
      if (paymentSummary.status === "rejected") partialErrors.push(`Payments: ${message(paymentSummary.reason)}`);
      setData({
        profile,
        documents: documents.status === "fulfilled" ? documents.value.data : [],
        applications: applications.status === "fulfilled" ? applications.value.data : [],
        bookings: bookings.status === "fulfilled" ? bookings.value.data : [],
        allocation: allocation.status === "fulfilled" ? allocation.value.data : null,
        paymentSummary: paymentSummary.status === "fulfilled" ? paymentSummary.value.data : null,
        partialErrors
      });
    } catch (err) {
      setError(message(err));
      setData(null);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return { data, isLoading, error, retry: load };
}

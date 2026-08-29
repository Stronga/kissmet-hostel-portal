import { useEffect, useState } from "react";
import { getApplicationBookingReport, getDashboardOverview, getFinancialReport, getMaintenanceReport, getOccupancyReport } from "../api/dashboard";
import type { ApplicationBookingReport, DashboardOverview, FinancialReport, MaintenanceReport, OccupancyReport } from "../types/api";

export interface DashboardData {
  overview: DashboardOverview;
  occupancy: OccupancyReport;
  finance: FinancialReport;
  applications: ApplicationBookingReport;
  maintenance: MaintenanceReport;
}

export function useDashboard() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const [overview, occupancy, finance, applications, maintenance] = await Promise.all([
          getDashboardOverview(),
          getOccupancyReport(),
          getFinancialReport(),
          getApplicationBookingReport(),
          getMaintenanceReport()
        ]);
        if (alive) setData({ overview, occupancy, finance, applications, maintenance });
      } catch (err) {
        if (alive) setError(err instanceof Error ? err.message : "Unable to load dashboard.");
      } finally {
        if (alive) setLoading(false);
      }
    }
    void load();
    return () => { alive = false; };
  }, []);

  return { data, loading, error };
}

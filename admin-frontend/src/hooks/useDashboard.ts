import { useEffect, useState } from "react";
import { getCommandCentre, type CommandCentre } from "../api/dashboard";

export function useDashboard(scope: { academicSessionId?: string; leasePeriodId?: string } = {}) {
  const [data, setData] = useState<CommandCentre | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    getCommandCentre(scope)
      .then((centre) => { if (alive) setData(centre); })
      .catch((err: unknown) => { if (alive) setError(err instanceof Error ? err.message : "Unable to load dashboard."); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [scope.academicSessionId, scope.leasePeriodId]);

  return { data, loading, error };
}

import { useEffect, useState } from "react";
import { listPublicInstitutions, type PublicInstitution } from "../api/institutions";
import { ApiError } from "../api/client";

export function useInstitutions() {
  const [institutions, setInstitutions] = useState<PublicInstitution[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    async function load() {
      try {
        const response = await listPublicInstitutions();
        if (active) setInstitutions(Array.isArray(response.data) ? response.data : []);
      } catch (err) {
        if (active) setError(err instanceof ApiError ? err.message : "Unable to load institutions.");
      } finally {
        if (active) setIsLoading(false);
      }
    }
    void load();
    return () => {
      active = false;
    };
  }, []);

  return { institutions, isLoading, error };
}

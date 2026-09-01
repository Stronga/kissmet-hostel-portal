import { apiRequest } from "./client";

export interface PublicInstitution {
  code: string;
  name: string;
}

export function listPublicInstitutions() {
  return apiRequest<{ ok: true; data: PublicInstitution[] }>("/public/institutions");
}

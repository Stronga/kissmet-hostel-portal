import type { ResidentDocument } from "../types/resident";

export const identityDocumentTypes = ["student_card", "ghana_card"] as const;
export type IdentityDocumentType = typeof identityDocumentTypes[number];

export const allowedDocumentMimeTypes = ["application/pdf", "image/jpeg", "image/png", "image/webp"];
export const maxDocumentSizeBytes = 5 * 1024 * 1024;

export function documentTypeLabel(type: string) {
  if (type === "student_card") return "Student Card";
  if (type === "ghana_card") return "Ghana Card";
  return "Document";
}

export function documentStatusLabel(status?: string | null) {
  if (status === "uploaded") return "Awaiting verification";
  if (status === "verified") return "Verified";
  if (status === "rejected") return "Needs attention";
  return "Not uploaded";
}

export function documentActionLabel(type: IdentityDocumentType, document?: ResidentDocument | null) {
  const label = documentTypeLabel(type);
  if (!document) return `Upload ${label}`;
  if (document.status === "rejected") return `Re-upload ${label}`;
  return `Replace ${label}`;
}

export function formatFileSize(bytes?: number | null) {
  if (!bytes && bytes !== 0) return "Not available";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function latestIdentityDocuments(documents: ResidentDocument[]) {
  return Object.fromEntries(identityDocumentTypes.map((type) => [
    type,
    documents.filter((document) => document.document_type === type).sort((a, b) => b.id - a.id)[0] ?? null
  ])) as Record<IdentityDocumentType, ResidentDocument | null>;
}

export function validateIdentityDocumentFile(file: File | null) {
  if (!file) return "Choose a file to upload.";
  if (!allowedDocumentMimeTypes.includes(file.type)) return "Choose a PDF, JPEG, PNG, or WebP file.";
  if (file.size > maxDocumentSizeBytes) return "The maximum file size is 5 MB.";
  return null;
}

export function isDocumentUploaded(document?: ResidentDocument | null) {
  return document ? ["uploaded", "verified"].includes(document.status) : false;
}

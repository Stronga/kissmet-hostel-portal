import { useState } from "react";
import type { IdentityDocument } from "../../types/api";
import { downloadIdentityDocument } from "../../api/applications";
import { formatDateTime, formatStatus } from "../../utils/format";

function documentLabel(type: string) {
  return type === "ghana_card" ? "Ghana Card" : type === "student_card" ? "Student Card" : formatStatus(type);
}

async function download(document: IdentityDocument, setError: (message: string | null) => void) {
  setError(null);
  try {
    const { blob, filename } = await downloadIdentityDocument(document.id);
    const url = URL.createObjectURL(blob);
    const link = window.document.createElement("a");
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
  } catch (err) {
    setError(err instanceof Error && err.message === "Forbidden"
      ? "You do not have permission to download this document."
      : err instanceof Error ? err.message : "Download failed.");
  }
}

export function DocumentReviewSection({ documents, hasRestrictedDocuments }: { documents: IdentityDocument[]; hasRestrictedDocuments?: boolean }) {
  const [error, setError] = useState<string | null>(null);

  if (!documents.length && !hasRestrictedDocuments) {
    return <p className="text-sm text-text-secondary">No identity document metadata is available for this applicant from the current admin document API.</p>;
  }

  return (
    <div className="space-y-2">
      {hasRestrictedDocuments ? (
        <p className="rounded border border-amber-200 bg-amber-50 p-3 text-sm text-text-primary">
          A restricted identity document is on file for this applicant. A staff member with the required access must review it.
        </p>
      ) : null}
      {documents.map((document) => (
        <div key={document.id} className="rounded border border-border p-3 text-sm">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="font-semibold text-text-primary">{documentLabel(document.document_type)}</p>
            <span className="text-xs font-semibold text-text-secondary">{formatStatus(document.status)}</span>
          </div>
          <p className="mt-1 text-text-secondary">{document.original_filename || "Stored file"}</p>
          {document.last_accessed_at ? (
            <p className="mt-1 text-xs text-text-secondary">Last accessed {formatDateTime(document.last_accessed_at)}{document.last_accessed_by ? ` by ${document.last_accessed_by}` : ""}</p>
          ) : (
            <p className="mt-1 text-xs text-text-secondary">Not yet downloaded</p>
          )}
          <p className="mt-1 text-xs text-text-secondary">Private R2 file content is never exposed as a public URL. Downloads are short-lived staff-session transfers only.</p>
          <button
            type="button"
            onClick={() => void download(document, setError)}
            className="mt-2 rounded-md border border-border px-3 py-1.5 text-sm font-medium"
          >
            Download
          </button>
        </div>
      ))}
      {error ? <p className="text-sm font-semibold text-danger" role="alert">{error}</p> : null}
    </div>
  );
}

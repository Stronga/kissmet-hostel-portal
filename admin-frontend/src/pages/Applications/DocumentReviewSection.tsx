import type { IdentityDocument } from "../../types/api";
import { formatStatus } from "../../utils/format";

function documentLabel(type: string) {
  return type === "ghana_card" ? "Ghana Card" : type === "student_card" ? "Student Card" : formatStatus(type);
}

export function DocumentReviewSection({ documents }: { documents: IdentityDocument[] }) {
  if (!documents.length) {
    return <p className="text-sm text-text-secondary">No identity document metadata is available for this applicant from the current admin document API.</p>;
  }

  return (
    <div className="space-y-2">
      {documents.map((document) => (
        <div key={document.id} className="rounded border border-border p-3 text-sm">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="font-semibold text-text-primary">{documentLabel(document.document_type)}</p>
            <span className="text-xs font-semibold text-text-secondary">{formatStatus(document.status)}</span>
          </div>
          <p className="mt-1 text-text-secondary">{document.original_filename || "Private R2 object"}</p>
          <p className="mt-1 text-xs text-text-secondary">Private R2 file content is never exposed as a public URL. Ghana Card content requires the backend's narrower permission.</p>
        </div>
      ))}
    </div>
  );
}

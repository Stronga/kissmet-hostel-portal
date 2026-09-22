import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "../../components/common/Button";
import { Card } from "../../components/common/Card";
import { ErrorState } from "../../components/common/ErrorState";
import { InfoHelp } from "../../components/common/InfoHelp";
import { LoadingState } from "../../components/common/LoadingState";
import { StatusBadge } from "../../components/common/StatusBadge";
import { PageHeader } from "../../components/layout/PageHeader";
import { fetchResidentDocuments, uploadResidentIdentityDocument } from "../../api/resident";
import { usePageTitle } from "../../hooks/usePageTitle";
import type { ResidentDocument } from "../../types/resident";
import { documentActionLabel, documentStatusLabel, documentTypeLabel, formatFileSize, identityDocumentTypes, isDocumentUploaded, latestIdentityDocuments, validateIdentityDocumentFile, type IdentityDocumentType } from "../../utils/documents";
import { formatDateTime } from "../../utils/format";

type UploadState = Record<IdentityDocumentType, { error: string | null; success: string | null; isUploading: boolean }>;

function initialUploadState(): UploadState {
  return {
    student_card: { error: null, success: null, isUploading: false },
    ghana_card: { error: null, success: null, isUploading: false }
  };
}

function whyRequired(type: IdentityDocumentType) {
  if (type === "student_card") {
    return "A Student Card is required for application readiness and identity verification.";
  }
  return "A Ghana Card is required for application readiness and identity verification.";
}

function RequirementSummary({ documents }: { documents: Record<IdentityDocumentType, ResidentDocument | null> }) {
  const uploadedCount = identityDocumentTypes.filter((type) => isDocumentUploaded(documents[type])).length;
  return (
    <Card className="mb-5">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="inline-flex items-center gap-1 text-sm font-semibold text-text-secondary">
            Required documents
            <InfoHelp label="About required documents">
              Upload completeness and staff verification are tracked separately. Both Student Card and Ghana Card are required before application submission.
            </InfoHelp>
          </p>
          <h2 className="mt-1 text-xl font-bold text-text-primary">{uploadedCount} of 2 uploaded</h2>
        </div>
        <StatusBadge status={uploadedCount === 2 ? "uploaded" : "pending"} />
      </div>
    </Card>
  );
}

function DocumentCard({ type, document, state, onUpload }: { type: IdentityDocumentType; document: ResidentDocument | null; state: UploadState[IdentityDocumentType]; onUpload: (type: IdentityDocumentType, file: File | null) => void }) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const label = documentTypeLabel(type);
  const rejected = document?.status === "rejected";

  return (
    <Card>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h2 className="inline-flex items-center gap-1 text-lg font-bold text-text-primary">
            {label}
            <InfoHelp label={`Why ${label} is required`}>{whyRequired(type)}</InfoHelp>
          </h2>
          <p className="mt-1 text-[13px] text-text-secondary">Private identity document via secure Kissmet storage.</p>
        </div>
        <span className="inline-flex items-center gap-1">
          <StatusBadge status={documentStatusLabel(document?.status)} />
          <InfoHelp label={`About ${label} status`}>
            Uploaded documents await staff verification. Rejected documents must be uploaded again. Secure viewing is not exposed by the current resident backend.
          </InfoHelp>
        </span>
      </div>
      <dl className="mt-5 grid gap-4 sm:grid-cols-2">
        <div>
          <dt className="text-xs font-semibold uppercase tracking-wide text-text-secondary">Current file</dt>
          <dd className="mt-1 break-words text-sm font-semibold text-text-primary">{document?.original_filename ?? "Not uploaded"}</dd>
        </div>
        <div>
          <dt className="text-xs font-semibold uppercase tracking-wide text-text-secondary">File size</dt>
          <dd className="mt-1 text-sm font-semibold text-text-primary">{formatFileSize(document?.size_bytes)}</dd>
        </div>
        <div>
          <dt className="text-xs font-semibold uppercase tracking-wide text-text-secondary">Format</dt>
          <dd className="mt-1 text-sm font-semibold text-text-primary">{document?.content_type ?? "Not available"}</dd>
        </div>
        <div>
          <dt className="text-xs font-semibold uppercase tracking-wide text-text-secondary">Uploaded</dt>
          <dd className="mt-1 text-sm font-semibold text-text-primary">{formatDateTime(document?.created_at)}</dd>
        </div>
      </dl>
      {rejected ? (
        <div className="mt-4 rounded-2xl border border-danger/30 bg-danger/5 p-3 text-sm text-text-primary">
          {document.rejection_reason || "This document needs to be uploaded again."}
        </div>
      ) : null}
      <div className="mt-5 space-y-3">
        <label className="block text-sm font-semibold text-text-primary" htmlFor={`${type}-file`}>{documentActionLabel(type, document)}</label>
        <input
          ref={inputRef}
          id={`${type}-file`}
          name={`${type}-file`}
          type="file"
          accept="application/pdf,image/jpeg,image/png,image/webp"
          className="block w-full rounded-xl border border-border bg-white px-3 py-2 text-sm text-text-primary file:mr-3 file:rounded-full file:border-0 file:bg-muted file:px-3 file:py-2 file:text-sm file:font-semibold file:text-text-primary"
        />
        <p className="text-xs text-text-secondary">PDF, JPEG, PNG, or WebP. Maximum 5 MB.</p>
        {state.error ? <p className="text-sm font-semibold text-danger" role="alert">{state.error}</p> : null}
        {state.success ? <p className="text-sm font-semibold text-success">{state.success}</p> : null}
        <div className="flex flex-col gap-2 sm:flex-row">
          <Button className="w-full rounded-full sm:w-auto" disabled={state.isUploading} onClick={() => onUpload(type, inputRef.current?.files?.[0] ?? null)}>
            {state.isUploading ? "Uploading..." : documentActionLabel(type, document)}
          </Button>
        </div>
      </div>
    </Card>
  );
}

export function DocumentsPage() {
  const [documents, setDocuments] = useState<ResidentDocument[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [uploadState, setUploadState] = useState<UploadState>(() => initialUploadState());
  const uploadsInFlight = useRef<Record<IdentityDocumentType, boolean>>({ student_card: false, ghana_card: false });
  usePageTitle("Documents");

  async function load() {
    setIsLoading(true);
    setError(null);
    try {
      const response = await fetchResidentDocuments();
      setDocuments(response.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load documents.");
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => { void load(); }, []);

  const identityDocuments = useMemo(() => latestIdentityDocuments(documents), [documents]);

  async function handleUpload(type: IdentityDocumentType, file: File | null) {
    const validationError = validateIdentityDocumentFile(file);
    if (validationError) {
      setUploadState((current) => ({ ...current, [type]: { error: validationError, success: null, isUploading: false } }));
      return;
    }
    if (uploadsInFlight.current[type]) return;
    uploadsInFlight.current[type] = true;
    setUploadState((current) => ({ ...current, [type]: { error: null, success: null, isUploading: true } }));
    try {
      await uploadResidentIdentityDocument(type, file!);
      const response = await fetchResidentDocuments();
      setDocuments(response.data);
      setUploadState((current) => ({ ...current, [type]: { error: null, success: `${documentTypeLabel(type)} uploaded.`, isUploading: false } }));
    } catch (err) {
      setUploadState((current) => ({ ...current, [type]: { error: err instanceof Error ? err.message : "Upload failed.", success: null, isUploading: false } }));
    } finally {
      uploadsInFlight.current[type] = false;
    }
  }

  if (isLoading) return <LoadingState label="Loading documents" />;
  if (error) {
    return <ErrorState title="Documents unavailable" message={error} onRetry={() => void load()} />;
  }

  return (
    <>
      <PageHeader title="Documents" description="Upload required identity documents for your application." />
      <RequirementSummary documents={identityDocuments} />
      <div className="grid gap-5 lg:grid-cols-2">
        {identityDocumentTypes.map((type) => (
          <DocumentCard key={type} type={type} document={identityDocuments[type]} state={uploadState[type]} onUpload={(docType, file) => void handleUpload(docType, file)} />
        ))}
      </div>
    </>
  );
}

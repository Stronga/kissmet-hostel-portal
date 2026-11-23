/** Allowed upload MIME types mapped to safe filename extensions. */
const ALLOWED_UPLOADS: Record<string, string[]> = {
  "application/pdf": [".pdf"],
  "image/jpeg": [".jpg", ".jpeg"],
  "image/png": [".png"],
  "image/webp": [".webp"]
};

const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
const MAX_FILENAME_LENGTH = 180;
const DANGEROUS_EXTENSIONS = new Set([
  ".html", ".htm", ".shtml", ".svg", ".svgz", ".js", ".mjs", ".cjs",
  ".ts", ".tsx", ".jsx", ".php", ".asp", ".aspx", ".jsp", ".cgi",
  ".exe", ".bat", ".cmd", ".com", ".msi", ".dll", ".sh", ".ps1",
  ".jar", ".war", ".py", ".rb", ".pl", ".wasm", ".xml", ".xhtml",
  ".htm", ".svg"
]);

export type ValidatedUpload = {
  safeFilename: string;
  contentType: string;
  size: number;
  extension: string;
};

function extensionOf(name: string): string {
  const base = name.split(/[/\\]/).pop() ?? name;
  const idx = base.lastIndexOf(".");
  if (idx <= 0) return "";
  return base.slice(idx).toLowerCase();
}

/**
 * Validate upload metadata for identity documents and payment slips.
 * Trusting browser-provided MIME alone is insufficient; extension must match
 * an allowlisted pair and dangerous types are rejected.
 * Residual malware risk remains (no content scanning platform).
 */
export function validateUploadFile(file: File, label = "Document"): ValidatedUpload {
  if (!file || typeof file !== "object" || !("stream" in file)) {
    throw new Error(`${label} file is required`);
  }

  const rawName = typeof file.name === "string" ? file.name : "upload";
  if (rawName.length > MAX_FILENAME_LENGTH) throw new Error(`${label} filename is too long`);
  if (rawName.includes("\0") || /[\r\n]/.test(rawName)) throw new Error(`Invalid ${label.toLowerCase()} filename`);

  const extension = extensionOf(rawName);
  if (!extension) throw new Error(`Unsupported ${label.toLowerCase()} type`);
  if (DANGEROUS_EXTENSIONS.has(extension)) throw new Error(`Unsupported ${label.toLowerCase()} type`);

  const contentType = (file.type || "").toLowerCase().trim();
  const allowedExts = ALLOWED_UPLOADS[contentType];
  if (!allowedExts || !allowedExts.includes(extension)) {
    throw new Error(`Unsupported ${label.toLowerCase()} type`);
  }

  if (!Number.isFinite(file.size) || file.size <= 0) throw new Error(`${label} file is required`);
  if (file.size > MAX_UPLOAD_BYTES) throw new Error(`${label} file too large`);

  const basename = (rawName.split(/[/\\]/).pop() ?? "upload")
    .replace(/[^A-Za-z0-9_.-]/g, "_")
    .replace(/^\.+/, "_");
  const safeFilename = (basename || `upload${extension}`).slice(0, MAX_FILENAME_LENGTH);

  return { safeFilename, contentType, size: file.size, extension };
}

/** Build a Content-Disposition attachment header with a safe ASCII filename. */
export function contentDispositionAttachment(filename: string): string {
  const ascii = filename.replace(/[^\x20-\x7E]/g, "_").replace(/["\\]/g, "_") || "download";
  return `attachment; filename="${ascii}"`;
}

export const UPLOAD_MAX_BYTES = MAX_UPLOAD_BYTES;

const ALLOWED_DOWNLOAD_TYPES = new Set(Object.keys(ALLOWED_UPLOADS));

/** Opaque R2 object key. No resident id, document type, payment reference, or filename. */
export function opaqueObjectKey(): string {
  return `objects/${crypto.randomUUID()}`;
}

function hasPrefix(bytes: Uint8Array, prefix: number[]): boolean {
  return bytes.length >= prefix.length && prefix.every((b, i) => bytes[i] === b);
}

/** Magic-byte checks for allowlisted upload types. MIME/extension alone is not sufficient. */
export function matchesUploadMagic(bytes: Uint8Array, contentType: string): boolean {
  const type = contentType.toLowerCase().trim();
  if (type === "application/pdf") return hasPrefix(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d]); // %PDF-
  if (type === "image/jpeg") return hasPrefix(bytes, [0xff, 0xd8, 0xff]);
  if (type === "image/png") return hasPrefix(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (type === "image/webp") {
    return hasPrefix(bytes, [0x52, 0x49, 0x46, 0x46]) && bytes.length >= 12
      && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50;
  }
  return false;
}

export async function assertUploadMagicBytes(file: File, label = "Document"): Promise<void> {
  const head = new Uint8Array(await file.slice(0, 16).arrayBuffer());
  const contentType = (file.type || "").toLowerCase().trim();
  if (!matchesUploadMagic(head, contentType)) {
    throw new Error(`Unsupported ${label.toLowerCase()} type`);
  }
}

/** Never serve identity documents or slips as HTML or a non-allowlisted type. */
export function safeDownloadContentType(contentType: string | null | undefined): string {
  const type = (contentType || "").toLowerCase().trim();
  return ALLOWED_DOWNLOAD_TYPES.has(type) ? type : "application/octet-stream";
}

export function documentDownloadHeaders(filename: string, contentType: string | null | undefined): HeadersInit {
  return {
    "Content-Type": safeDownloadContentType(contentType),
    "Content-Disposition": contentDispositionAttachment(filename),
    "X-Content-Type-Options": "nosniff",
    "Cache-Control": "private, no-store",
    "Referrer-Policy": "no-referrer"
  };
}

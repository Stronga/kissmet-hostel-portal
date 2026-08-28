export function ok<T>(data: T) {
  return { ok: true, data };
}

export function listOk<T>(items: T[], pagination: { limit: number; offset: number }) {
  return { ok: true, data: items, pagination };
}

export function error(message: string, code = "bad_request") {
  return { ok: false, error: { code, message } };
}

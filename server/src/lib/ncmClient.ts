import { AppError } from "../utils/AppError";

/**
 * Thin HTTP client for the NCM (Nepal Can Move) vendor API.
 * API reference: .claude/skills/ncm-api. Base URL + vendor token come from
 * env so the same code talks to the local mock (server/ncm-mock) in dev and
 * the real host in production. Tokens never leave the server.
 */

const REQUEST_TIMEOUT_MS = 10_000;

export function isNcmConfigured(): boolean {
  return Boolean(process.env.NCM_BASE_URL && process.env.NCM_API_TOKEN);
}

type NcmRequestOptions = {
  method?: "GET" | "POST";
  query?: Record<string, string | number | undefined>;
  body?: unknown;
  /** GETs are safe to retry once on network/5xx failures; POSTs are not
   *  retried by default (order create must never run twice). */
  retryOnce?: boolean;
};

export async function ncmFetch<T = any>(path: string, options: NcmRequestOptions = {}): Promise<T> {
  if (!isNcmConfigured()) {
    throw new AppError(503, "NCM integration is not configured (NCM_BASE_URL / NCM_API_TOKEN)");
  }

  const { method = "GET", query, body } = options;
  const retryOnce = options.retryOnce ?? method === "GET";

  const url = new URL(path, process.env.NCM_BASE_URL);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }
  }

  let lastError: unknown;
  for (let attempt = 0; attempt <= (retryOnce ? 1 : 0); attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, 500));
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const init: RequestInit = {
        method,
        headers: {
          Authorization: `Token ${process.env.NCM_API_TOKEN}`,
          ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        },
        signal: controller.signal,
      };
      if (body !== undefined) init.body = JSON.stringify(body);
      const response = await fetch(url, init);

      const text = await response.text();
      let json: any = null;
      try {
        json = text ? JSON.parse(text) : null;
      } catch {
        // non-JSON body; fall through with the raw text in the error below
      }

      if (!response.ok) {
        // 5xx from NCM is retriable; 4xx is a real answer, surface it.
        if (response.status >= 500 && attempt === 0 && retryOnce) {
          lastError = new Error(`NCM ${response.status}: ${text.slice(0, 200)}`);
          continue;
        }
        throw new AppError(
          response.status >= 500 ? 502 : response.status,
          formatNcmError(json, response.status),
          "NCM_ERROR",
          response.status === 429 ? parseRetryAfterSeconds(response, json) : undefined,
        );
      }

      return json as T;
    } catch (error) {
      if (error instanceof AppError) throw error;
      // network failure / timeout
      lastError = error;
      if (attempt === 0 && retryOnce) continue;
      const message = error instanceof Error ? error.message : String(error);
      throw new AppError(502, `NCM request failed: ${message}`, "NCM_UNREACHABLE");
    } finally {
      clearTimeout(timer);
    }
  }

  const message = lastError instanceof Error ? lastError.message : String(lastError);
  throw new AppError(502, `NCM request failed: ${message}`, "NCM_UNREACHABLE");
}

// DRF's throttle response sends a standard `Retry-After` header, but NCM's
// demo host doesn't always echo it — fall back to parsing the number out of
// the human-readable `detail` string ("Request was throttled. Expected
// available in 60 seconds.") it always does send.
function parseRetryAfterSeconds(response: Response, json: any): number | undefined {
  const header = response.headers.get("Retry-After");
  if (header && /^\d+$/.test(header)) return Number(header);
  const match = typeof json?.detail === "string" ? json.detail.match(/available in (\d+)/i) : null;
  return match ? Number(match[1]) : undefined;
}

// NCM error bodies come in two shapes: {"detail": "..."} for simple errors
// and {"Error": {field: message, ...}} for field-level create failures.
function formatNcmError(json: any, status: number): string {
  if (json?.detail) return `NCM: ${json.detail}`;
  if (json?.Error && typeof json.Error === "object") {
    const fields = Object.entries(json.Error)
      .map(([field, message]) => `${field}: ${message}`)
      .join("; ");
    return `NCM rejected the order — ${fields}`;
  }
  // Some errors (e.g. invalid branch name) come back as a plain string
  // rather than the field-level object shape above.
  if (typeof json?.Error === "string") return `NCM: ${json.Error}`;
  if (json?.message) return `NCM: ${json.message}`;
  return `NCM request failed with status ${status}`;
}

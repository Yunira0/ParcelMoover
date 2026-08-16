import { AppError } from "../utils/AppError";

/**
 * Thin HTTP client for the Upaya courier API — our second outside-valley
 * carrier, alongside NCM (see ncmClient.ts, same shape). Base URL + API key
 * come from env; the key never leaves the server. Upaya's docs are partial
 * (no confirmed error-body shape), so error normalization here is best-effort
 * and should be tightened once we can see real error responses.
 */

const REQUEST_TIMEOUT_MS = 10_000;

export function isUpayaConfigured(): boolean {
  return Boolean(process.env.UPAYA_BASE_URL && process.env.UPAYA_API_KEY);
}

type UpayaRequestOptions = {
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  query?: Record<string, string | number | undefined>;
  body?: unknown;
  /** GETs are safe to retry once on network/5xx failures; POSTs are not
   *  retried by default (order create must never run twice). */
  retryOnce?: boolean;
};

export async function upayaFetch<T = any>(path: string, options: UpayaRequestOptions = {}): Promise<T> {
  if (!isUpayaConfigured()) {
    throw new AppError(503, "Upaya integration is not configured (UPAYA_BASE_URL / UPAYA_API_KEY)");
  }

  const { method = "GET", query, body } = options;
  const retryOnce = options.retryOnce ?? method === "GET";

  const url = new URL(path, process.env.UPAYA_BASE_URL);
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
          "X-API-Key": process.env.UPAYA_API_KEY as string,
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
        // 5xx from Upaya is retriable; 4xx is a real answer, surface it.
        if (response.status >= 500 && attempt === 0 && retryOnce) {
          lastError = new Error(`Upaya ${response.status}: ${text.slice(0, 200)}`);
          continue;
        }
        throw new AppError(
          response.status >= 400 && response.status < 500 ? 502 : response.status,
          formatUpayaError(json, response.status, text),
          "UPAYA_ERROR",
          response.status === 429 ? parseRetryAfterSeconds(response) : undefined,
        );
      }

      return json as T;
    } catch (error) {
      if (error instanceof AppError) throw error;
      // network failure / timeout
      lastError = error;
      if (attempt === 0 && retryOnce) continue;
      const message = error instanceof Error ? error.message : String(error);
      throw new AppError(502, `Upaya request failed: ${message}`, "UPAYA_UNREACHABLE");
    } finally {
      clearTimeout(timer);
    }
  }

  const message = lastError instanceof Error ? lastError.message : String(lastError);
  throw new AppError(502, `Upaya request failed: ${message}`, "UPAYA_UNREACHABLE");
}

function parseRetryAfterSeconds(response: Response): number | undefined {
  const header = response.headers.get("Retry-After");
  return header && /^\d+$/.test(header) ? Number(header) : undefined;
}

// Upaya's error-body shape isn't documented; try the common field names
// before falling back to the raw status/text so a failure is still legible.
function formatUpayaError(json: any, status: number, text: string): string {
  if (json?.message && typeof json.message === "string") return `Upaya: ${json.message}`;
  if (json?.error && typeof json.error === "string") return `Upaya: ${json.error}`;
  if (json?.detail && typeof json.detail === "string") return `Upaya: ${json.detail}`;
  if (json?.errors) return `Upaya rejected the request — ${JSON.stringify(json.errors)}`;
  if (text) return `Upaya request failed with status ${status}: ${text.slice(0, 200)}`;
  return `Upaya request failed with status ${status}`;
}

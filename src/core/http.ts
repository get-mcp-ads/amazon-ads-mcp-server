/** Copyright 2026 GetMCPAds. SPDX-License-Identifier: Apache-2.0 */

/**
 * Every fetch in this codebase passes redirect: "error". A mocked or unusual
 * runtime can still hand back a 3xx response, so it is refused here too. The
 * Location header is never echoed: it can carry a signed URL.
 */
export function refuseRedirect(response: Response, api: string): void {
  if (response.status < 300 || response.status >= 400) return;
  throw new Error(`${api} returned an unexpected HTTP ${response.status} redirect. Redirects are never followed.`);
}

export class ResponseTooLargeError extends Error {
  constructor(readonly limit: number) {
    super(`Response exceeds the ${Math.round(limit / 1024 / 1024)} MB limit.`);
    this.name = "ResponseTooLargeError";
  }
}

/** Reads a response body without ever holding more than maxBytes. */
export async function readBounded(response: Response, maxBytes: number): Promise<Uint8Array> {
  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader();
  const parts: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > maxBytes) {
        await reader.cancel().catch(() => undefined);
        throw new ResponseTooLargeError(maxBytes);
      }
      parts.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const output = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) { output.set(part, offset); offset += part.byteLength; }
  return output;
}

export async function readBoundedText(response: Response, maxBytes: number): Promise<string> {
  return new TextDecoder().decode(await readBounded(response, maxBytes));
}

/** Discards a body without reading it, so the connection is released. */
export async function discard(response: Response): Promise<void> {
  await response.body?.cancel().catch(() => undefined);
}

/**
 * Removes credentials from text that may reach the model or the logs. Known
 * secrets are replaced verbatim, and any Login with Amazon token shape is
 * replaced even when it is not one of ours.
 */
export function redact(text: string, secrets: readonly string[] = []): string {
  let out = text;
  for (const secret of secrets) if (secret && secret.length >= 6) out = out.split(secret).join("[REDACTED]");
  return out.replace(/Atz[ar]\|[A-Za-z0-9_\-+/=|.%]+/g, "[REDACTED]");
}

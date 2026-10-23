/** Copyright 2026 GetMCPAds. SPDX-License-Identifier: Apache-2.0 */
/**
 * Amazon identifiers are 64-bit integers that JSON.parse would round. Both
 * directions keep every digit: large integers arrive as strings, and IDs that
 * the schema marks as integers leave as exact JSON numbers.
 */

/** JSON integers outside IEEE-754's exact range must never be rounded into another ad ID. */
export function parseAmazonJson(text: string): unknown {
  return JSON.parse(text.replace(/"(?:[^"\\]|\\.)*"|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g, token => {
    if (token.startsWith('"') || !/^-?\d+$/.test(token)) return token;
    return Number.isSafeInteger(Number(token)) ? token : JSON.stringify(token);
  }));
}

/** A schema-validated native integer ID, serialized as a JSON number without rounding. */
export class AmazonInteger {
  constructor(readonly value: string) {
    if (!/^[1-9]\d{0,19}$/.test(value)) throw new Error("Invalid native Amazon integer ID.");
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function stringifyAmazonJson(value: any): string {
  if (value instanceof AmazonInteger) return value.value;
  if (Array.isArray(value)) return `[${value.map(v => v === undefined ? "null" : stringifyAmazonJson(v)).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value).filter(([, v]) => v !== undefined).map(([k, v]) => `${JSON.stringify(k)}:${stringifyAmazonJson(v)}`).join(",")}}`;
  if (typeof value === "number" && (!Number.isFinite(value) || Number.isInteger(value) && !Number.isSafeInteger(value))) throw new Error("Unsafe numeric Amazon value; supply IDs as strings.");
  return JSON.stringify(value);
}

/** Stable key order, so a preview and its confirmation hash the same change. */
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map(k => `${JSON.stringify(k)}:${canonical(record[k])}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

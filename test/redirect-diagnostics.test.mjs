import { test } from "node:test";
import assert from "node:assert/strict";
import { refuseRedirect } from "../src/core/http.ts";
import { assertSafeProviderUrl } from "../src/core/hosts.ts";
test("redirect errors do not disclose signed URLs or credentials", () => {
  const response = new Response(null, { status: 302, headers: { location: "https://example.com/?access_token=private-token" } });
  assert.throws(() => refuseRedirect(response, "Provider"), error => error.message.includes("302") && !error.message.includes("private-token") && !error.message.includes("example.com"));
  assert.doesNotThrow(() => refuseRedirect(new Response("{}"), "Provider"));
});
test("provider URLs must be HTTPS Amazon S3 hosts, never private addresses", () => {
  for (const url of ["https://reports.s3.eu-west-1.amazonaws.com/f?X-Amz-Signature=abc", "https://bucket.s3.amazonaws.com/f", "https://s3-us-west-2.amazonaws.com/b/f"]) {
    assert.doesNotThrow(() => assertSafeProviderUrl(url, "report download"), url);
  }
  for (const url of ["http://reports.s3.amazonaws.com/f", "https://127.0.0.1/f", "https://169.254.169.254/latest/meta-data", "https://[::1]/f", "https://localhost/f",
    "https://reports.s3.amazonaws.com.evil.org/f", "https://user@reports.s3.amazonaws.com/f", "https://reports.s3.amazonaws.com:8443/f", "https://10.0.0.1/f", "https://metadata.google.internal/f", "not a url"]) {
    assert.throws(() => assertSafeProviderUrl(url, "report download"), error => !error.message.includes("Signature") && !error.message.includes("evil"), url);
  }
});

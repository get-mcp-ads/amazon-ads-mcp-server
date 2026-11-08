/** Copyright 2026 GetMCPAds. SPDX-License-Identifier: Apache-2.0 */
import { z } from "zod";
import { assertSafeProviderUrl } from "../core/hosts.js";
import { discard, refuseRedirect } from "../core/http.js";
import { sha256Hex } from "../core/sealed.js";
import { approve, confirmation } from "./approval.js";
import { amazonAssetId } from "./assets.js";
import { account, failed, ok, register, scoped, type AmazonRuntime, type Collector } from "./shared.js";

const UPLOAD_TTL_MS = 15 * 60_000;
const MAX_UPLOAD_BYTES = 16 * 1024 * 1024;
const CONTENT_TYPES = ["image/png", "image/jpeg", "video/mp4", "video/quicktime"] as const;
const uploadToken = z.string().min(1).max(16000);

type UploadJob = { profileId: string; url: string; expires: number; contentType: (typeof CONTENT_TYPES)[number]; assetType: "IMAGE" | "VIDEO" };

function job(rt: AmazonRuntime, token: string, profileId: string): UploadJob {
  const value = rt.sealer.unseal("upload", token) as Partial<UploadJob> | null;
  if (!value) throw new Error("Invalid Amazon upload token.");
  if (value.profileId !== profileId || !Number.isFinite(value.expires) || Number(value.expires) < Date.now() ||
    !CONTENT_TYPES.includes(value.contentType as UploadJob["contentType"]) || !["IMAGE", "VIDEO"].includes(String(value.assetType))) {
    throw new Error("Upload token expired or belongs to another profile. Prepare a new upload.");
  }
  assertSafeProviderUrl(value.url, "asset upload");
  return value as UploadJob;
}

export function registerAmazonAssetUploads(c: Collector, rt: AmazonRuntime): void {
  register(c, "amazon_ads_prepare_asset_upload", "Prepare an Amazon image or video upload for this profile. After preview and confirmation, returns a short-lived native S3 URL. Send the bytes with amazon_ads_upload_asset_bytes, or PUT them to that exact URL without Amazon credentials and with the returned content type, then call amazon_ads_register_uploaded_asset with uploadToken. This does not create or activate an ad.", {
    ...account,
    fileName: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._ -]{0,180}\.(png|jpg|jpeg|mp4|mov)$/i).describe("File name including a supported image or video extension."),
    contentType: z.enum(CONTENT_TYPES).describe("Actual MIME type of the bytes that will be uploaded."),
    ...confirmation,
  }, async a => {
    const { api, profileId } = scoped(rt, a.accountId);
    const ext = a.fileName.split(".").pop().toLowerCase(), expected: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", mp4: "video/mp4", mov: "video/quicktime" };
    if (expected[ext] !== a.contentType) throw new Error("File extension and contentType must agree.");
    const preview = approve(rt, a, { operation: "prepare_asset_upload", accountId: profileId, fileName: a.fileName, contentType: a.contentType });
    if (preview) return preview;
    const result = await api.request<{ url: string }>("/assets/upload", profileId, "POST", { fileName: a.fileName }, "application/json", "application/vnd.creativeassetsuploadresponse.v3+json");
    const url = assertSafeProviderUrl(result.url, "asset upload").href, expires = Date.now() + UPLOAD_TTL_MS;
    const token = rt.sealer.seal("upload", { profileId, url, expires, contentType: a.contentType, assetType: a.contentType.startsWith("video/") ? "VIDEO" : "IMAGE" });
    return ok({ accountId: profileId, uploadUrl: url, method: "PUT", headers: { "content-type": a.contentType }, uploadToken: token, tokenExpiresAt: new Date(expires).toISOString(),
      nextAction: { tool: "amazon_ads_upload_asset_bytes" }, message: "Upload the bytes next. Never send Amazon credentials to this URL. Registration does not establish ad eligibility." });
  });
  register(c, "amazon_ads_upload_asset_bytes", "Upload supplied image or video bytes to the native S3 URL bound to the opaque uploadToken from amazon_ads_prepare_asset_upload. No Amazon credentials are sent to S3. Preview and confirmation bind the byte digest. Register the asset afterwards; this does not create an ad.", {
    ...account,
    uploadToken: uploadToken.describe("Opaque profile-bound upload token returned by amazon_ads_prepare_asset_upload."),
    bytesBase64: z.string().min(4).max(22_369_624).regex(/^[A-Za-z0-9+/]+={0,2}$/).describe("Exact image or video bytes encoded as base64, without a data URL prefix, up to 16 MiB."),
    ...confirmation,
  }, async a => {
    const { profileId } = scoped(rt, a.accountId);
    const upload = job(rt, a.uploadToken, profileId);
    const bytes = Buffer.from(a.bytesBase64, "base64");
    if (!bytes.length || bytes.length > MAX_UPLOAD_BYTES) throw new Error("Upload exceeds 16 MiB.");
    const digest = sha256Hex(bytes);
    const preview = approve(rt, a, { operation: "upload_asset_bytes", accountId: profileId, uploadToken: a.uploadToken, byteLength: bytes.length, digest });
    if (preview) return preview;
    let response: Response;
    try {
      response = await fetch(upload.url, { method: "PUT", redirect: "error", headers: { "content-type": upload.contentType }, body: bytes, signal: AbortSignal.timeout(45_000) });
    } catch {
      return failed({ applied: false, outcomeUnknown: true, message: "Amazon media upload did not complete; its outcome is unknown. Prepare a new upload rather than retrying this one." });
    }
    refuseRedirect(response, "Amazon media storage");
    await discard(response);
    if (!response.ok) return failed({ applied: false, status: response.status, message: `Amazon media upload returned HTTP ${response.status}. Prepare a new upload before retrying.` });
    return ok({ applied: true, uploadToken: a.uploadToken, byteLength: bytes.length, digest, nextAction: { tool: "amazon_ads_register_uploaded_asset" } });
  });
  register(c, "amazon_ads_register_uploaded_asset", "Register bytes already uploaded to the Amazon URL from amazon_ads_prepare_asset_upload. The source URL comes from the profile-bound token; arbitrary URLs are not accepted. Preview then confirm. Returns native assetId, versionId and specification failures. Images and videos remain subject to placement requirements and moderation.", {
    ...account,
    uploadToken: uploadToken.describe("Opaque profile-bound token from amazon_ads_prepare_asset_upload, after a successful byte upload."),
    name: z.string().trim().min(1).max(128).describe("Asset name shown in the Amazon creative asset library."),
    tags: z.array(z.string().min(1).max(100)).max(20).optional().describe("Optional searchable library tags."),
    asins: z.array(z.string().regex(/^[A-Z0-9]{10}$/)).min(1).max(100).optional().describe("Optional product ASIN associations in this marketplace."),
    ...confirmation,
  }, async a => {
    const { api, profileId } = scoped(rt, a.accountId);
    const upload = job(rt, a.uploadToken, profileId);
    const body = { url: upload.url, name: a.name, assetType: upload.assetType, assetSubTypeList: [upload.assetType === "VIDEO" ? "BACKGROUND_VIDEO" : "OTHER_IMAGE"], ...(a.tags ? { tags: a.tags } : {}), ...(a.asins ? { asinList: a.asins } : {}) };
    const preview = approve(rt, a, { operation: "register_uploaded_asset", accountId: profileId, uploadToken: a.uploadToken, name: a.name, tags: a.tags ?? [], asins: a.asins ?? [] });
    if (preview) return preview;
    const result = await api.request<Record<string, unknown>>("/assets/register", profileId, "POST", body, "application/json", "application/vnd.creativeassetsregisterresponse.v3+json");
    const applied = amazonAssetId.safeParse(result.assetId).success && typeof result.versionId === "string";
    const value = { accountId: profileId, applied, ...result, message: "Read this asset to obtain fresh native image or video URLs. Specification failures describe placement eligibility; registration alone is not ad approval." };
    return applied ? ok(value) : failed(value);
  });
}

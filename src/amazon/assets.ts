/** Copyright 2026 GetMCPAds. SPDX-License-Identifier: Apache-2.0 */
import { z } from "zod";
import { account, nextToken, ok, register, scoped, type AmazonRuntime, type Collector } from "./shared.js";

export const amazonAssetId = z.string().regex(/^amzn1\.assetlibrary\.[A-Za-z0-9._-]{1,180}$/);
const asin = z.string().regex(/^[A-Z0-9]{10}$/);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;

/** A native image or video, normalized for the model. URLs are Amazon's own, never guessed. */
export type NativeVisual = {
  id: string; nativeAssetId: string; nativeAssetVersion?: string; platform: "amazon_ads"; kind: "image" | "video";
  name: string; nameSource: "asset"; thumbnail: string | null; link: string | null; assetUrl: string | null; video?: string;
  width?: number; height?: number;
};

/** Only native Amazon media hosts. Never guess a higher resolution or a product URL. The URL is returned as data, never fetched. */
export function amazonMediaUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    const u = new URL(value);
    return u.protocol === "https:" && !u.username && !u.password && !u.port &&
      (u.hostname === "m.media-amazon.com" || u.hostname === "images-na.ssl-images-amazon.com" || u.hostname === "images-eu.ssl-images-amazon.com") ? u.href : null;
  } catch { return null; }
}

export function amazonAsset(row: Row): NativeVisual | null {
  const assetId = row.assetId ?? row.assetIdentifier?.assetId;
  if (typeof assetId !== "string") return null;
  const kind = row.assetType === "VIDEO" || /video|mp4|mov/i.test(row.fileMetadata?.contentType ?? row.fileMetadata?.extension ?? "") ? "video" : "image";
  const locations = row.storageLocationUrls ?? {};
  const variants: [string, unknown][] = [...Object.entries(locations.processedUrls ?? {}), ...(row.assetFiles?.processedFiles ?? []).map((f: Row) => [f.profile, f.url] as [string, unknown])];
  const original = amazonMediaUrl(locations.defaultUrl ?? row.assetFiles?.defaultUrl ?? row.url);
  const thumbnail = variants.filter(([profile]) => /THUMBNAIL|COVER/i.test(profile)).map(([, url]) => amazonMediaUrl(url)).find(Boolean) ?? (kind === "image" ? original : null);
  const video = kind === "video" ? variants.filter(([profile]) => /^MP4/i.test(profile)).map(([, url]) => amazonMediaUrl(url)).find(Boolean) ?? original : null;
  if (!thumbnail && !video) return null;
  return { id: assetId, nativeAssetId: assetId, ...(typeof row.assetIdentifier?.version === "string" ? { nativeAssetVersion: row.assetIdentifier.version } : {}), platform: "amazon_ads", kind, name: row.name || assetId, nameSource: "asset",
    thumbnail, link: video ?? original ?? thumbnail, assetUrl: original, ...(video ? { video } : {}),
    width: row.fileMetadata?.width || row.fileMetadata?.resolutionWidth || undefined,
    height: row.fileMetadata?.height || row.fileMetadata?.resolutionHeight || undefined };
}

export function amazonProductAssets(products: Row[]): NativeVisual[] {
  return products.flatMap(p => {
    const url = amazonMediaUrl(p.imageUrl);
    if (!url || typeof p.asin !== "string") return [];
    return [{ id: p.asin, nativeAssetId: p.asin, platform: "amazon_ads" as const, kind: "image" as const,
      name: p.title || p.asin, nameSource: "asset" as const, thumbnail: url, link: url, assetUrl: url }];
  });
}

export function registerAmazonAssets(c: Collector, rt: AmazonRuntime): void {
  register(c, "amazon_ads_list_creative_assets", "Search the Amazon creative asset library: images, logos and videos, native download or playback URLs, sizes and moderation metadata. One page; continue with nextToken using the same filters. Uploaded assets are not proof of campaign use or delivery. Sponsored Products images come from amazon_ads_get_product_metadata instead.", {
    ...account,
    text: z.string().max(200).optional().describe("Optional free-text search over asset names and tags."),
    assetType: z.enum(["IMAGE", "VIDEO"]).optional().describe("Restrict results to images or videos."),
    limit: z.number().int().min(1).max(100).prefault(50).describe("Maximum assets in this page, up to 100."),
    nextToken,
  }, async a => {
    const { api, profileId } = scoped(rt, a.accountId);
    const result = await api.request<Row>("/assets/search", profileId, "POST", {
      ...(a.text ? { text: a.text } : {}), ...(a.assetType ? { filterCriteria: { valueFilters: [{ valueField: "ASSET_TYPE", values: [a.assetType] }] } } : {}),
      pageCriteria: { size: a.limit, ...(a.nextToken ? { identifier: { token: a.nextToken } } : {}) }, sortCriteria: { field: "CREATED_TIME", order: "DESC" },
    }, "application/json", "application/vnd.creativeassetssearchassetsresponse.v3+json");
    if (!Array.isArray(result.assetList)) throw new Error("Amazon returned an invalid asset library response.");
    const assets = result.assetList.map(amazonAsset).filter(Boolean);
    return ok({ accountId: profileId, assets, metadata: result.assetList, nextToken: result.token ?? null,
      totalRecords: result.totalRecords, partial: Boolean(result.token), unresolvedAssets: result.assetList.length - assets.length,
      notes: ["Library assets may be unused. Moderation status does not prove ad eligibility. Refresh by asset ID when URLs expire."] });
  });
  register(c, "amazon_ads_get_creative_asset", "Refresh one native Amazon image or video asset in the selected profile. Returns every version and its files; no guessed URLs and no cross-profile fallback. Pass its native assetId from amazon_ads_list_creative_assets.", {
    ...account, assetId: amazonAssetId.describe("Native asset library ID, starting with amzn1.assetlibrary."),
  }, async a => {
    const { api, profileId } = scoped(rt, a.accountId);
    const result = await api.request<Row>(`/assets?${new URLSearchParams({ assetId: a.assetId })}`, profileId, "GET", undefined, "application/vnd.creativeassetsgetresponse.v3+json");
    if (result.assetGlobal?.assetId !== a.assetId || !Array.isArray(result.assetVersionList)) throw new Error("Amazon asset ID mismatch or malformed response.");
    const versions = result.assetVersionList.map((v: Row) => ({ ...v, assetId: a.assetId, assetType: result.assetGlobal.assetType }));
    return ok({ accountId: profileId, assetId: a.assetId, assets: versions.map(amazonAsset).filter(Boolean), versions,
      notes: ["Versions are not separate ads. Video covers do not establish motion or audio."] });
  });
  register(c, "amazon_ads_get_product_metadata", "Read advertised product titles, native image URLs, stock, price and eligibility from the advertiser's Amazon catalog. Retrieves Sponsored Products visuals without scraping retail pages. Page through pageIndex or Amazon's cursorToken; product images are not complete rendered ads.", {
    ...account,
    asins: z.array(asin).min(1).max(100).optional().describe("Exact ten-character ASINs to read. Use this or search, not both."),
    search: z.string().min(1).max(200).optional().describe("Free-text catalog search. Use this or asins, not both."),
    adProduct: z.enum(["SP", "SB", "SD"]).prefault("SP").describe("Ad product whose eligibility rules apply: SP Sponsored Products, SB Brands, SD Display."),
    pageIndex: z.number().int().min(0).max(99).prefault(0).describe("Zero-based page number. Use nextPageIndex from the previous call."),
    limit: z.number().int().min(1).max(100).prefault(50).describe("Maximum products in this page, up to 100."),
    cursorToken: z.string().min(1).max(8192).optional().describe("Opaque cursor returned by Amazon. When present it replaces pageIndex."),
  }, async a => {
    if (a.asins && a.search) throw new Error("Use ASINs or search, not both.");
    const { api, profileId } = scoped(rt, a.accountId);
    const result = await api.request<Row>("/product/metadata", profileId, "POST", {
      adType: a.adProduct, checkItemDetails: true, checkEligibility: true, pageIndex: a.pageIndex, pageSize: a.limit,
      ...(a.asins ? { asins: a.asins } : {}), ...(a.search ? { searchStr: a.search } : {}), ...(a.cursorToken ? { cursorToken: a.cursorToken } : {}),
    }, "application/vnd.productmetadatarequest.v1+json", "application/vnd.productmetadataresponse.v1+json");
    if (!Array.isArray(result.ProductMetadataList)) throw new Error("Amazon returned an invalid product metadata response.");
    const products = result.ProductMetadataList;
    const hasMore = Boolean(result.cursorToken) || (typeof result.totalCount === "number" ? (a.pageIndex + 1) * a.limit < result.totalCount : products.length === a.limit);
    return ok({ accountId: profileId, products, assets: amazonProductAssets(products), totalCount: result.totalCount,
      cursorToken: result.cursorToken ?? null, nextPageIndex: hasMore && !result.cursorToken ? a.pageIndex + 1 : null, partial: hasMore,
      notes: ["These are catalog product images, not complete ad previews. Names are product titles, not campaign or ad names."] });
  });
}

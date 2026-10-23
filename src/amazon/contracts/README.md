# Amazon native write contracts

`operations.json` contains 39 single-entity request schemas extracted by the getmcpads gateway from Amazon's public OpenAPI specifications on 2026-09-16. This repository takes both files from gateway revision `3e1c2c8`, together with `sp-expression.json`, and keeps only their structure: field names, types, enum values, required fields and constraints. Amazon's description text is not included; read the linked specifications for the meaning of each field.

- [Sponsored Products v3 JSON](https://d1y2lf8k3vrkfu.cloudfront.net/openapi/en-us/dest/SponsoredProducts_prod_3p.json) (generates `sp-expression.json`)
- [Sponsored Brands v4 JSON](https://d3a0d0y2hgofx6.cloudfront.net/openapi/en-us/sponsored-brands/4-0/openapi.json)
- [Brands targeting v3 YAML](https://d3a0d0y2hgofx6.cloudfront.net/openapi/en-us/sponsored-brands/3-0/openapi.yaml)
- [Sponsored Display v3 YAML](https://d3a0d0y2hgofx6.cloudfront.net/openapi/en-us/sponsored-display/3-0/openapi.yaml)

The extraction dereferences schemas, merges `allOf` object properties, removes documentation-only fields and unwraps bulk arrays. It preserves request and response media types, nested creative fields, enum values and constraints.

At run time, `src/amazon/native-management.ts` adds the rules the specifications leave out: required parent identifiers where older Amazon specifications omit them, single-entity confirmation, paused creation, ownership checks and lossless numeric identifier serialization. Sponsored Display creative properties allow combinations; target `oneOf` branches remain distinct.

Each operation becomes one tool. The tool name is derived from the family, the entity and, for Brands ad formats, the last path segment, as in the gateway. The `amazon-ads://write-contracts` resource lists them.

Reporting: [ad reports](https://advertising.amazon.com/API/docs/en-us/guides/reporting/v3/report-types/ad), [advertised product reports](https://advertising.amazon.com/API/docs/en-us/guides/reporting/v3/report-types/advertised-product). Amazon marks `sbAds` as preview, and it excludes legacy campaigns without multi-ad-group support. Purchase KPIs use click-attributed columns for all three sponsored products, not mixed click and view totals.

Media: [Creative Asset Library specification](https://d3a0d0y2hgofx6.cloudfront.net/openapi/en-us/creative-asset-library/creative-asset-library-openapi.yaml). Upload uses Amazon's signed S3 URL without forwarding credentials; registration requires a profile-bound token. Asset files are refreshed from authenticated metadata, never guessed or scraped from retail pages.

To refresh the contracts, regenerate them in the gateway and copy both files here, then run `npm test`.

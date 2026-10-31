# Site-scoped block baselines

`profiles/<block-id>.json` describes the reusable block structure, capability requirements, and assertions. It does not contain a site baseline or CMS fixture names.

Site-owned state lives in `sites/<site-host>/<block-id>.baseline.json`. The host is lowercased and includes a non-default port. Each document carries `version`, `siteHost`, `blockId`, `steps`, the selected block `instance` (first DOM instance, its setting ID and position), and optional `fixtureRefs`.

Scalar controls such as pagination, button text, and colors are captured by dialog/control identity. CMS-backed checkbox collections use `fixtureSelection`: the exact AUTOTEST fixture items and their selected states are checked/restored; `otherItemsPolicy: "ignored"` allows unrelated site fields, products, and categories to change without changing the block baseline. The selected radio/mode control remains a normal control assertion.

The baseline path is resolved from the configured `SITE_DOMAIN` host. A document whose embedded host or block ID differs is a hard error. If no baseline exists anywhere for that block, a live run captures the current state without saving any editor settings, records it at the site-scoped path, and reports an onboarding capture. If a baseline exists for another host, automatic onboarding is refused as a host mismatch. The capture utility is read-only; restoration is explicit and uses the same site-scoped document.

Migration helper (local files only): `BROWSER=chromium node scripts/migrate-site-baselines.mjs <BLOCK_ID>`. It moves legacy baseline and fixture references out of the profile. Recapture from the current site with `node scripts/capture-baseline.mjs <BLOCK_ID>`.

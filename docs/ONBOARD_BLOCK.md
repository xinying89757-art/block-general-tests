# One-command block onboarding

`node scripts/onboard-block.mjs` creates a draft profile for a previously unseen block and runs the existing fresh-block flow against that draft. The target page is mandatory; the command never chooses one automatically.

```sh
BLOCK_ID=<id> SITE_DOMAIN=<host> BROWSER=chromium \
  node scripts/onboard-block.mjs --block <id> \
  --page-kind system --page-id <page-id> --page-url <path>
```

For a custom page, pass `--page-kind custom --page-name <name>` instead. System page identity and its page-specific editor URL are checked against `sites/<host>/pages.json`. The site host is data from the environment; it is not embedded in the onboarding code.

Editor entry detects login pages/forms as `ENV_LOGIN_REQUIRED`. If the generic site-list card selector is not ready, it waits and retries the site-list navigation once, within bounded timeouts, before using the configured editor URL fallback. Exhausted entry retries are reported as environment entry errors rather than setting assertion results.

The flow uses the ordinary fresh-block lifecycle: on the explicitly selected page it deletes every instance with the requested block number, verifies non-target block counts, adds one default instance, and saves/reloads it. Only then does onboarding read the fresh instance's settings inventory. This ensures discovery observes defaults, not the old instance's configured values. The inventory pass is read-only. Existing capability signatures map only unique detected setting identities. If a setting identity matches more than one region, onboarding fails closed before writing a profile or running settings checks. Controls with no signature remain in `profile.onboarding.unmapped`; they are never assigned a capability by label guesswork.

The command clones `profiles/TEMPLATE.json`, removes site fixture references, records the explicit target page and discovered requirement locations, and writes `profiles/<id>.json` with `onboarding.status: "draft-unreviewed"`. It does not invent fixture data, expected values, or assertions. Mapped capability runners reuse their existing oracles; capabilities without enough profile data report their normal skip/not-adapted status. The generated profile must be reviewed and completed before routine `test:block` use.

An existing unreviewed onboarding draft can be regenerated. An existing reviewed profile is protected; replacing it requires the explicit `--overwrite-reviewed` flag. Do not use that flag unless replacing the reviewed profile is intended.

Each run writes a JSON report and a Chinese summary under `reports/`. The summary lists the auto-mapped setting IDs, unmapped controls, result counts, and page links. AUTOTEST fixtures and page content are not deleted by onboarding; only instances of the requested block number are replaced as specified by the fresh-block flow.

If the requested block is absent from all searchable module-library modes, onboarding records `status: "environment-unavailable"` and `environmentOutcome: "TARGET_BLOCK_NOT_IN_MODULE_LIBRARY"` in a JSON report, with the page links and stop stage. No profile inventory/settings batch/publication is implied by that report. This is an availability outcome, not an assertion failure. The separate read-only inventory command is `npm run list:modules -- --block <id> --page-kind system --page-id <id> --page-url <path>`; online inventory is a target-number search, not an exhaustive catalog.

# Fixture state and baseline

`fixture-state.json` is the single source of truth for the shared AUTOTEST
dataset. Regular runs only change block settings and restore them; they never
create or repair CMS data unless an explicit baseline mode is used. A pre-run
guard (`checkFixtureData`) compares records by id, stops on drift, and never
auto-repairs.

The data contract is the fixture spec (see `schemas/fixture-spec.schema.json`).
Dodo drafts are consumed as-is. Runtime ids, last-checked time and per-block
pages live in `fixture-state.json` (`schemas/fixture-state.schema.json`). Site
credentials are a pointer (`kind` + `path`) and are never inlined.

Data access goes through `prepareFixtureData(state)` and `checkFixtureData(state)`
in `src/fixture-data-ops.mjs`, behind an adapter so a later API can replace the
CMS UI implementation.

## Baseline modes

These are three different operations. One flag no longer gates all of them.

1. **Default `--live-readonly`** (this is the default if you pass no mode):
   log in, read the site's actual custom-field cap and existing field count,
   scan leftover AUTOTEST fields by name, and verify existing ids. Write
   nothing to the site. Results go into `fixture-state.json` and the progress
   file.
2. **`--create-missing`**: create only the missing AUTOTEST data (for example
   category B, products B-1 and B-2, and display fields up to the cap), then
   write the new ids back to `fixture-state.json`. This mode never deletes
   anything.
3. **`--dedupe-apply`**: delete leftover duplicate AUTOTEST fields. This needs
   separate approval and never runs by default or as part of `--create-missing`.

`--offline` is a file-only path for tests. `--apply` is no longer accepted.

The command is resumable via `--resume` and `reports/fixture-baseline-progress.json`.
Any display-field shortfall against the cap is recorded in
`fixture-state.fieldLimitReport` / `omittedDisplayFields`; it does not fail
the baseline.

## Runrun commands (box)

Identity flags are required; nothing is hardcoded in the scripts. Example
(47948 / en-site79106751; the env file is passed, not printed):

```bash
cd /workspace/bgt-fix-onboard
git fetch origin && git checkout feat/filter-evidence-collection && git pull --ff-only
export RUN_ENV_FILE=/workspace/47948/codex/.run.env

# 1. Default: log in, read the cap, scan leftovers, verify ids (no site writes)
node scripts/fixture-baseline.mjs \
  --spec /workspace/47948/checklist/fixture-spec-draft.json \
  --from-existing reports/fresh-block-47948-1794210531557.json \
  --site-host en-site79106751.ldwebsite.com \
  --site-id en-site79106751 \
  --block 47948 \
  --setting-id wiKlpCRWyerd \
  --page-id BIAUYnyOREPZ \
  --page-url /products.html \
  --page-kind system \
  --page-name Products \
  --out fixture-state.json

# 2. After reviewing the readonly report, create only missing AUTOTEST data
node scripts/fixture-baseline.mjs \
  --spec /workspace/47948/checklist/fixture-spec-draft.json \
  --from-existing reports/fresh-block-47948-1794210531557.json \
  --create-missing \
  --site-host en-site79106751.ldwebsite.com \
  --site-id en-site79106751 \
  --block 47948 \
  --setting-id wiKlpCRWyerd \
  --page-id BIAUYnyOREPZ \
  --page-url /products.html \
  --out fixture-state.json

# 3. Only with separate approval: delete leftover AUTOTEST fields
node scripts/fixture-baseline.mjs \
  --spec /workspace/47948/checklist/fixture-spec-draft.json \
  --dedupe-apply \
  --site-host en-site79106751.ldwebsite.com \
  --site-id en-site79106751 \
  --block 47948 \
  --setting-id wiKlpCRWyerd \
  --page-id BIAUYnyOREPZ \
  --page-url /products.html \
  --out fixture-state.json
```

The spec includes option C on the multi-select field, allows empty expected
sets (「下拉=B 且 多选=B」), marks 暂缓 items as deferred, and treats text
match as exact once confirmed. Product 热门/新/推荐 flags stay off the
baseline while that data-source control is deferred.

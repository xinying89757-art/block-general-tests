# Fixture state and baseline

`fixture-state.json` is the single source of truth for the shared AUTOTEST
dataset. Regular runs only change block settings and restore them; they never
create or repair CMS data. A pre-run guard (`checkFixtureData`) compares records
by id, stops on drift, and never auto-repairs.

The data contract is the fixture spec (see `schemas/fixture-spec.schema.json`).
Dodo drafts are consumed as-is. Runtime ids, last-checked time and per-block
pages live in `fixture-state.json` (`schemas/fixture-state.schema.json`). Site
credentials are a pointer (`kind` + `path`) and are never inlined.

Data access goes through `prepareFixtureData(state)` and `checkFixtureData(state)`
in `src/fixture-data-ops.mjs`, behind an adapter so a later API can replace the
CMS UI implementation.

## One-time baseline (Runrun, box)

Identity flags are required; nothing is hardcoded in the scripts. `--dedupe`
only reports leftover AUTOTEST fields unless you also pass `--apply`. The
command is resumable via `--resume` and `reports/fixture-baseline-progress.json`.

Example (47948 / en-site79106751; the env file is passed, not printed):

```bash
cd /workspace/bgt-fix-onboard
git fetch origin && git checkout feat/filter-evidence-collection && git pull --ff-only
export RUN_ENV_FILE=/workspace/47948/codex/.run.env
node scripts/fixture-baseline.mjs \
  --spec /workspace/47948/checklist/fixture-spec-draft.json \
  --from-existing reports/fresh-block-47948-1794210531557.json \
  --dedupe \
  --site-host en-site79106751.ldwebsite.com \
  --site-id en-site79106751 \
  --block 47948 \
  --setting-id wiKlpCRWyerd \
  --page-id BIAUYnyOREPZ \
  --page-url /products.html \
  --page-kind system \
  --page-name Products \
  --out fixture-state.json
```

`--apply` is required before leftover fields are changed. The command reads
the site's actual maximum custom-field count from the CMS field list (or
`--field-limit` when running offline), reports it, and creates only as many
`AUTOTEST-展示字段-*` fields as still fit. Any shortfall is recorded in
`fixture-state.fieldLimitReport` / `omittedDisplayFields`; it does not fail
the baseline. `--category-limit` is still respected for a second category.

Live apply is not part of an offline CI run.

The spec includes option C on the multi-select field, allows empty expected
sets (「下拉=B 且 多选=B」), marks 暂缓 items as deferred, and treats text
match as exact once confirmed. Product 热门/新/推荐 flags stay off the
baseline while that data-source control is deferred.

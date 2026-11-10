# Filter evidence collection

Generic, credential-free-on-the-front workflow. Site, block, setting, page,
fields and products come from `--fixture-state`, `--profile`, CLI flags or env.
Examples below are for 47948 only; they are not baked into `src/` or `scripts/`.

Each step writes raw values and a screenshot. Filter field checkboxes are always
restored at the end, including on failure. A run changes only block settings
and then restores the baseline; CMS fixture data is read through
`checkFixtureData` and is never auto-repaired.

## Box (Runrun)

The optional `--control-change` is a per-page product count (unrelated to
`data-filterfields`). Values come from flags, profile or fixture; the 47948
example is 20 → 2, data source = category A (5 products), expecting 3 pages.
The new value stays published until the Mac front has verified the page count.
On a failed box run the original value is restored immediately.

```bash
cd /workspace/bgt-fix-onboard
git fetch origin && git checkout feat/filter-evidence-collection && git pull --ff-only
export RUN_ENV_FILE=/workspace/47948/codex/.run.env

# 2. Collect evidence, publish the page-size control change, do not restore it yet
node scripts/collect-filter-evidence.mjs \
  --profile profiles/47948.json \
  --fixture-state fixture-state.json \
  --setting-id wiKlpCRWyerd \
  --page-id BIAUYnyOREPZ \
  --page-url /products.html \
  --site-host en-site79106751.ldwebsite.com \
  --control-change \
  --control-field 每页产品数量 \
  --control-value 2 \
  --control-expected-pages 3 \
  --control-product-count 5 \
  --control-data-source 选择部分产品分类 \
  --control-category AUTOTEST-分类A
```

Steps, in order: (1) CMS read-back via `checkFixtureData`, (2) editor settings
read-back, (3) canvas `data-filterfields` after save and before publish (Mac
preview is the fallback only when the canvas attribute is missing; an empty
string still counts as a raw value), (4) publish with 当前页面发布 only, (5)
optional `--control-change` of a block setting (AUTOTEST-marked, verified,
restored; fixture data is not mutated), (6) is collected on the published front.

## Mac front (credential-free)

Pack on the box, then deliver the archive only into
`/Users/xinying/bgt-front-47948/` (never `bgt-mac`). Also copy
`fixture-state.json` and the box step-4 report into that directory; they are
not necessarily inside the git archive.

```bash
# on the box
scripts/pack-front-only.sh /tmp/front-only.tar.gz
# copy /tmp/front-only.tar.gz, fixture-state.json, and the box report
# into /Users/xinying/bgt-front-47948/ only

# on the Mac
cd /Users/xinying/bgt-front-47948
tar -xzf front-only.tar.gz
node scripts/collect-filter-evidence-front.mjs \
  --profile profiles/47948.json \
  --fixture-state fixture-state.json \
  --channel chrome \
  --box-report path/to/00-report.json \
  --url 'http://en-site79106751.ldwebsite.com/products.html'
```

The front script adds `?t=` itself, saves HTML, `data-filterfields`, response
headers, reads the published pagination count and compares it with
`expectedPages` from the box report, then selects a value, confirms it is
selected, and records network requests plus the product list. Classification
in the report is always labelled `suggestion`.

## Restore the control change after Mac verification (box)

```bash
cd /workspace/bgt-fix-onboard
export RUN_ENV_FILE=/workspace/47948/codex/.run.env
# 3. Restore the original per-page product count / data source and publish
node scripts/restore-filter-evidence-control.mjs \
  --states-file reports/filter-evidence-<stamp>/05-control-change-original.json \
  --site-host en-site79106751.ldwebsite.com
```

Replace `<stamp>` with the box evidence output directory. The snapshot already
records the original value, page and instance identity. Filter field checkboxes
are still restored at the end of the box evidence run, including on failure.
The page-size control is restored on box-run failure, or by this command after
a successful Mac verification.

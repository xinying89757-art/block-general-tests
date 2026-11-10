# Design checklist check types

The catalog is intentionally fixed in `schemas/design-checklist.schema.json` and
`DESIGN_CHECK_TYPES` in `src/design-spec-checklist.mjs`. The checklist carries
the per-block expected values and selectors; checkers contain reusable logic.
`npm run plan:design-checklist -- <block-id>` reads a profile only and shows
what each requirement can run at its declared stage, which checklist rows are
incomplete, and which rows need human review. It does not launch a browser.

| Check type | Editor checker | Front checker | Checklist data needed |
| --- | --- | --- | --- |
| `color-default` | — | Yes | `expected.value`; palette must be untouched in the run |
| `color-scope` | — | Yes | `expected` and profile-scoped `params.styleCheckId(s)` or learned scope |
| `typography` | — | Yes | expected font properties and profile mapping (`styleCheckId(s)`, selectors/structure as available) |
| `module-width` | Yes | — | `expected.expandable`, `expected.default`; an `overrides` waiver records the reason |
| `height-fit` | — | Unsupported / human review | preserve exact item in `designSpec.unsupportedRequirements` until a reusable oracle exists |
| `text-truncation` | — | Yes | `expected.maxLines`; optional `params.selectorCandidates` |
| `image-ratio` | — | Yes | `expected.ratio`, optional centering; only content images inside item/card containers are measured |
| `overflow-threshold` | — | Yes | `expected.threshold`, `expected.direction`; `params.containerSelector` and `params.itemSelector` |
| `nav-hierarchy-levels` | — | Yes | `expected.levels` or `expected.maxLevel`; optional `params.itemSelector` |
| `search-box-per-field` | — | Unsupported / human review | preserve original text in `designSpec.unsupportedRequirements` until a reusable oracle exists |
| `default-expand` | — | Yes | `expected.level` and optional `expected.collapsedLevel`; profile selectors optional |
| `selected-tag-behaviour` | — | Unsupported / human review | preserve original text in `designSpec.unsupportedRequirements` until a reusable oracle exists |
| `mobile-layout` | — | Yes | structured expected properties and `params.selectorCandidates`, role, or structure; run at mobile viewport |
| `filter-oracle` | Deferred to front | Yes | `expected.resultSet` or `cases` (empty sets are valid); combination rules use same-field union and cross-field intersection; 暂缓 / 待确认 rows are record-only |
| `filter-interaction` | Deferred to front | Yes | interaction expected values such as collapsing only the clicked column |
| `filter-layout` | Yes (structure) | Yes | `expected.columns` or layout flags |
| `manual` | — | Unsupported / human review | preserve original text and why it is not automated in `designSpec.unsupportedRequirements` |

Every emitted verdict carries `reason.code` as a string. A supported type may
still return `na` when its checklist lacks the data or the instance scope cannot
be resolved. That `na` includes a machine reason. Explicit unsupported rows and
unsupported catalog type/stage pairs are listed under report `humanReview` with
their original `sourceText`; they are never silently discarded. A waiver emits
an `na` verdict named `已知例外` with its recorded reason.

`overflow-threshold` compares the number of checklist-selected items with the
declared threshold and checks whether the uniquely selected instance container
has scroll extent in the declared direction exactly when the count exceeds the
threshold. `nav-hierarchy-levels` reads ARIA levels when present, otherwise
counts nested tree/list/details levels within the instance root. No selectors or
expected values are inferred across profiles.

## Existing oracle details

`color-default` compares the specified default against the unique instance's
computed styles only when the run did not overwrite that palette value. If the
run did overwrite it, the default row is `na` with
`palette-default-overridden-this-run`; the separate written-color check uses
`run-report.currentValues`. `color-scope` uses profile-owned functional check
IDs. The profile can map an ambiguous scope in `scopeOverrides`; a `分页文字`
scope refers to current-page text unless the source explicitly says otherwise.

Typography compares only `fontSize` and `fontWeight` when stated in the
checklist. `lineHeight` is never asserted in typography, pagination, button,
editor, or front checks; a legacy line-height-only requirement is informational
(`record`) and never contributes a pass/fail count. Checklist generation and
the schema reject `expected.lineHeight`. Typography does not mix palette color
or profile geometry into the verdict. Missing observations remain `na`.
`image-ratio` only uses content images inside item/card containers; banners and
full-width backgrounds are excluded unless a checklist explicitly declares a
background-image requirement. `mobile-layout` compares checklist requirements
at the mobile viewport. When no mobile items exist, the mobile integrity path
checks only the instance itself; page-wide overflow is informational.

## Diagnostic evidence

Written-color evidence separates recovered stylesheet reads from final fetch
failures and records whether unreadable sheets might apply to the selected
instance. A readable stylesheet with no matching instance selector is excluded;
an unreadable relevant sheet makes the result inconclusive rather than absent.
## Spec-targeted states

A front `color-scope` or `typography` requirement may declare:

```json
{
  "state": { "kind": "hover", "target": "scope", "timeoutMs": 4000 },
  "params": { "selector": ".named-button", "property": "backgroundColor" }
}
```

`kind` is `hover | focus | selected | expanded | active`. `target` is `scope`
(the unique scope element) or an instance-relative selector. Scope resolution
uses ordered candidates in this requirement or its mapped profile style item,
including editor-learned paths. No selector is borrowed from another profile.
Multiple matches fail closed. Color checks need a declared `params.property`
or exactly one property in the mapped style item; typography reads the stated
fontSize/fontWeight only. The value is read live after activation, never taken
from earlier functional-check results. Written colors take precedence over spec
defaults under the existing run-value mapping.

Only that target is activated and read; finally restores focus, hover, scroll,
pressed state or the original selected/expanded value. `selected` requires
checked/aria-selected/aria-pressed semantics; `expanded` requires aria-expanded
or details/summary semantics. For mutually exclusive selections, declare
`state.restoreTarget` as the instance-relative selector of the original item.
`active` observes an existing aria-current state or holds mouse-down for CSS
`:active`, then releases. Click activation/restoration refuses navigation links
and form controls. Missing semantics or unsuccessful restoration fails with a
specific string reason. Each action/read/restore has a bounded timeout (default
4000ms; configurable per item, 100–30000ms). No state field means no interaction.
State metadata is machine evidence only; human reports do not show selectors.

The importer and design-spec-to-block-checklist notes map 悬停/鼠标经过 → hover,
聚焦/焦点 → focus, 选中 → selected, 当前/激活 → active, 展开 → expanded, only on
color/typography scope items. Ambiguous wording does not infer an action; keep
it unmapped rather than guessing. Mapped selectors stay in profile data.

The retired CLI options `--exercise-states`, `--state-timeout-ms` and
`--state-action-timeout-ms` print one notice and are ignored. No generic state
scan or related report fields remain. G68 capture and structural finder
diagnostics (hierarchy, images, navigation and options) remain available.

## Image loading and ratio measurement

Before `image-ratio` measures selected primary media, it scrolls the instance in
viewport-sized steps and exposes images in nested scroll containers. The page's
own lazy loader must load them: the checker only **observes** `data-src`,
`data-original`, `srcset` and other source attributes, and never copies them into
`src`/`srcset`. It waits for `complete && naturalWidth > 0 && naturalHeight > 0`.
Original page and nested-container scroll positions are restored in `finally`.
There is no generic hover/toggle scan.

The total budget (selection, scrolling, waiting, measurements, restoration) is
8000 ms per requirement per viewport, **not per image**. The front CLI accepts
`--image-load-timeout 12000`; both the regular and fresh runners accept
`IMAGE_LOAD_TIMEOUT_MS=12000`. Values must be positive integer milliseconds.
The CLI option takes precedence over the environment variable. PC and mobile use
the same configured budget. This wait cannot make a failed image pass: after the
budget, an unloaded primary image retains `na` /
`primary-image-dimensions-unavailable`, with `actual.imageLoad.loaded/total`,
`timedOut`, `timeoutMs`, `elapsedMs` and restoration evidence. A known ratio
mismatch still fails even if peer images are unavailable.

The checklist can specify `params.ratioSource`:

| Source | Ratio that decides the verdict |
| --- | --- |
| `natural` | Loaded resource's intrinsic width / height |
| `rendered-content` | Visible graphic inside the CSS content box, accounting for `object-fit`, `object-position`, padding, borders and cropping |
| `rendered-element` | Rendered element border box (the declared image frame) |
| `both` | Both natural and visible-content ratios must match |

Explicit original-image wording selects natural size; explicit frame wording
selects the element box; explicit displayed/cropped-image wording selects visible
content. Otherwise the existing natural-size oracle is retained; the tool never
selects whichever source happens to pass. Existing background-image requirements
retain their rendered-box oracle; an explicit natural-size background requirement
is `na` when its intrinsic size cannot be read. No existing spec ratio is changed.

JSON stores both natural and rendered measurements, content/element boxes,
object fit/position, whether cropped, the deciding source and its provenance.
A `cover` crop may therefore be square while its original is rectangular; a
`contain` image retains its original visible ratio within a square frame.
Unloaded foreground images cannot pass using the frame dimensions alone.
Source evidence records attribute names/presence/length, never source URL values.

## Verdict policy: 人工判断 (2026-11-01)

`human-review` is a first-class result, counted separately from `pass`, `fail`
and `na` under `summary["human-review"]`. The Chinese label is **人工判断**.
It means the automated check has no verdict and does not mean the requirement
passed. Assertions, expected values, raw observations and machine reason codes
are retained. This policy applies identically to editor/front checklist results,
fresh reports, front-only JSON/Chinese summaries, merges and HTML.

- Missing test data (no child hierarchy/navigation levels or filter options in
  the instance) becomes 人工判断 with “测试数据缺少…，需人工判断”.
- Existing `humanReviewRequired` na results, including unsupported checkers,
  unmapped scopes and incomplete spec/typography observations, also become
  人工判断. Operational unknowns are the exception: unloaded/missing images,
  timeouts, missing instance roots, locator ambiguity and read errors remain
  `na`, unless a checklist explicitly requests review for that reason.
- `waived` remains `na` / **已知例外**, with its original reason. It is not a
  human-review result. Deferred front work remains `deferred`.
- A real measured `pass` or `fail` is never changed by a human-review override.
  Root failure deduplication remains unchanged; review counts count check rows.
  The older front summary's `na` counter still includes `skip` for compatibility;
  fresh/merged reports retain a separate `skip` counter.

A profile may declare:

```json
{
  "requirementId": "child-category-font",
  "status": "human-review",
  "reason": "测试数据缺少子级分类，需人工判断。",
  "whenReasonCodes": ["typography-hierarchy-level-unresolved"]
}
```

`reason` must be non-empty; optional `whenReasonCodes` is a non-empty array of
non-empty machine reason strings. Without that field the override applies to
any otherwise-na result of this requirement. With it, an exact top-level or
underlying mapped-check reason must match. Functional checks mapped by that
requirement's `params.styleCheckId(s)` inherit the same conditional rule; no
block id, label or selector is embedded in policy code. The validator requires a
real requirement id. Machine reasons remain in `reason.code` and
`evidence.humanReview`; the human summary shows only the spec text/review reason,
never selector matching. The shared implementation is `src/human-review.mjs`.

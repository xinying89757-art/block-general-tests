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

Typography compares only properties stated in the checklist among
`fontSize`, `fontWeight`, and `lineHeight`. It does not mix palette color or
profile geometry into the verdict. Missing observations remain `na`.
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
State exercise stays inside the selected instance and records attempted,
opened, and restored counts. It does not follow links or submit forms.

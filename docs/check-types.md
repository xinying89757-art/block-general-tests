# Design checklist check types

`profile.designSpec.requirements` uses this fixed, versioned catalog. A profile
may attach profile-local selector/check mappings in `params`; code never
selects a different block's selectors. Selector details are machine evidence
only and are not copied into the human summary.

| Check type | Intended check | Current generic execution |
|---|---|---|
| `color-default` | A stated default color is present in the target instance | Front: compare computed text/background/border colors against the exact stated color only when that palette value was not changed by the run. If the run wrote another value, report `na` (`palette-default-overridden-this-run`); the independent written-color check verifies the value actually set. |
| `color-scope` | A stated color applies to a stated functional scope | Front: use profile-local `styleCheckIds`; missing mappings return `na`. A `分页文字` scope maps to current-page text unless the spec explicitly says otherwise. |
| `typography` | Typography stated in the design source | Front: compare only stated `fontSize`, `fontWeight`, and `lineHeight` properties against values observed by a profile-local functional check. Color and geometry are excluded; missing typography observations return `na`, observed mismatches fail. Unmapped scopes return `na`. Font-size controls are not discovered or written. |
| `module-width` | Full-row expansion setting exists with the stated default | Editor: inspect the module-width inventory; absence or wrong default fails unless waived. |
| `height-fit` | Height adapts to content | `na` until a profile supplies a repeatable content-growth oracle. |
| `text-truncation` | Text is limited to a stated number of lines | `na` until a block-local functional check is mapped. |
| `image-ratio` | Image ratio and alignment | `na` until a block-local image scope is mapped. |
| `overflow-threshold` | Overflow appears beyond a stated count | `na` until a profile supplies the relevant list and threshold. |
| `search-box-per-field` | Each field has a search control | `na` until a profile maps the field and search scopes. |
| `default-expand` | Default expanded level/state | `na` until a profile maps the hierarchy and state oracle. |
| `selected-tag-behaviour` | Selected-tag display/removal behavior | `na` until a profile maps the selected-tag interaction. |
| `mobile-layout` | Stated mobile-specific difference/layout | `na` until a profile maps both viewport scopes. |
| `manual` | Written requirement without a safe automatic oracle | Always `na` with a machine reason; values are never inferred. |

Supported results are `pass`, `fail`, and `na`. Waived requirements use
`status: na`, `classification: known-exception`, and the profile's exact
override reason; the human renderer labels these `已知例外`.

Without a design-spec default, every written color from the `区块配色` control
group gets a separate front check based on `run-report.currentValues`. Any
matching computed `color`, `backgroundColor`, or `borderColor` inside the
unique block-number + `settingId` instance root passes. No element selector is
required for this presence check. If a profile candidate has no match, the
runner can derive link candidates from semantic list hierarchy inside the
unique instance root. No evidence means `na`, not a guessed selector.

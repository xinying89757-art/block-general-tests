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
| `text-truncation` | Text is limited to a stated number of lines | Front: profile selectors when supplied, otherwise instance elements with a rendered line clamp; compares the stated maximum and ellipsis behavior. No evidence is `na` for human review. |
| `image-ratio` | Image ratio and alignment | Front: profile selectors when supplied, otherwise measurable images inside the instance; compares the stated ratio and optional centering. |
| `overflow-threshold` | Overflow appears beyond a stated count | `na` until a profile supplies the relevant list and threshold. |
| `search-box-per-field` | Each field has a search control | `na` until a profile maps the field and search scopes. |
| `default-expand` | Default expanded level/state | Front: reads accessible hierarchy levels and disclosure state inside the instance; compares the stated default level. No readable hierarchy is `na` for human review. |
| `selected-tag-behaviour` | Selected-tag display/removal behavior | `na` until a profile maps the selected-tag interaction. |
| `mobile-layout` | Stated mobile-specific difference/layout | Structured checklist values (visibility, display/flex direction, columns, dimensions, typography) are compared inside the instance at mobile width. If there are no mobile checklist items, only instance-integrity checks run: internal overflow, clipped text, overlap, and elements spilling outside their boxes. Page-level overflow is informational only. |
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

Auto-learned per-property placeholders with null expected values are not emitted
as front checks. The written-color presence check is the applicable oracle for
those palette writes. Requirements without a safe oracle remain `na` with a
string machine reason code and `humanReviewRequired: true`; they remain visible
for human review and are never coerced into a pass.

## Diagnostic evidence for written colors and mobile integrity

The written-color JSON evidence separates terminal `fetchFailures` from
`recoveredFetches`; `fetchFailureCount` equals the terminal failure array
length. Readable stylesheets with no selector matching the selected instance
are listed in `excludedSheets`, as are recognizable font-only resources.
Unreadable resources make a color result `inconclusive-stylesheet-unavailable`
only while their contents could still include a rule for the instance. If all
potentially relevant sheets were read and the color is absent from rendered
styles, the result remains `absent` (fail).

State exercise is restricted to the selected instance. It can inspect
accessible disclosure/toggle/tab/combobox controls, native selects and
`details`, plus pointer controls that cannot navigate or submit. It records
attempted, opened and restored counts; it never follows links or submits forms.
On mobile without mobile-specific checklist requirements, overlap pairs count
only when both visible elements are inside the instance bounds and neither is
fixed/sticky. Instance-internal overflow and clipping remain findings; page-only
overflow is informational. Overlap selector identifiers in diagnostic JSON
are serialized as readable strings.

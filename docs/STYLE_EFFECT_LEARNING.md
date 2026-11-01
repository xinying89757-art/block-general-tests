# Editor-learned front style scopes

Front style checks run only inside the uniquely identified instance root. The
runner resolves that root from the generic `data-appid` block number and the
instance `settingId`; it does not use a generated block-number class. Each
block profile owns an ordered `selectorCandidates` list for a function-level
style check.

For settings that declare `requirements.capabilities[].styleEffect`, the fresh
batch adapter snapshots the declared computed CSS properties on every element
inside that instance before applying the setting. After the setting has been
saved, it snapshots again and keeps instance-relative structural paths for
elements whose property changed. The profile's `styleSpec.items[]` entry named
by `styleEffect.checks[].checkId` stores those learned paths under
`learnedSelectors[property]`, together with the computed value observed after
the write. Generated classes matching `blockCon<N>` and element IDs are not
part of learned paths. A later fresh run replaces stale learned entries for
the settings it actually applies.

Example shape (all values here are illustrative):

```json
{
  "id": "some-profile-setting",
  "styleEffect": {
    "properties": ["backgroundColor", "color"],
    "checks": [
      { "property": "backgroundColor", "checkId": "some-front-check" }
    ],
    "candidateSelectors": [".profile-owned-candidate"]
  }
}
```

If no declared property changes, an existing profile-owned candidate can still
locate the functional element and compare its computed values with the written
value. Without a readable candidate, the check is `na` with a JSON machine
reason. A human-facing result does not include which
candidate matched. The setting's existing editor assertion remains unchanged.
Color controls in the editor's `区块配色` section are detected by control shape
and section metadata. Font-size controls are not discovered as settings:
font sizes are fixed by the block implementation. A font size is checked only
when a profile's design checklist states an expected value and maps it to a
block-owned functional check; otherwise it remains record-only or `na`. Width,
height, padding, and other CSS lengths are never inferred as font sizes.
Unless a profile supplies an explicit `styleEffect` override, the shared
adapter derives observable CSS properties for color writes and creates generic
style checks. These checks use the setting-unit id and property; their human
name describes only the function being checked.

For each color write, the adapter captures the target instance before opening
that setting's editor surface and before its individual apply, then again
after the apply but before the batch save, so opening a panel cannot hide the
initial canvas and two palette settings in one batch cannot claim each other's
effects. Canvas roots use the editor's generic `.siteblocks-setting-wrap`
wrapper, matched by block number and settingId, and fail closed unless unique.
Editor-canvas diff learning is
diagnostic only; the front assertion for a written `区块配色` value succeeds
when any element in the uniquely identified block instance has that computed
color in text, background, border, outline, SVG fill/stroke, shadow, gradient,
or `::before`/`::after` styles. Font sizes are hardcoded, not writable settings; onboarding does not
create pending font-size effects. Font size checks come only from a stated
design-spec requirement and a profile-owned functional mapping.

The same discovery path composes writable units from inventory controls in
the `区块配色` group that have not already been claimed by a capability.
Color inputs are considered present when either the input itself or its
associated visible picker surface is rendered; editor color pickers may keep
their backing text input hidden. Each generated unit is located by its profile
requirement (region, occurrence, control type and identity), writes a distinct
deterministic alternate color, checks the saved value, and provides an
initial-value restore operation. Existing capability-owned controls are
excluded by persisted-control references so their assertions remain
authoritative. Onboarding stores color requirements and binds matching
pending effects by region and control identity.

An unlearned automatic check is `na` in the machine report with its reason;
the human-facing summary does not show selector matches or compatibility
details. Candidate selectors are only drawn from that block's own canvas
snapshot; they never come from another block's profile.

Front state exercise resolves the actual clickable owner and rejects links and
their descendants, forms and submit controls before activation. Class/DOM
snapshots detect disclosure changes and verify restoration, including widgets
without ARIA expanded state. `--state-action-timeout-ms` defaults to 4000ms;
the existing overall state limit remains configurable. The real CLI smoke
includes a nested navigation link, a class-switched disclosure, mobile
typography, and a color available only in cross-origin instance-scoped CSS.

Image-ratio discovery targets content images in item/card containers. Profiles
can declare `params.contentContainerSelector` for their content layout.
Background images participate only when `params.imageKind` is `background`;
an ordinary image's background-position does not determine its centering.

## Palette readback and optional CSS-source diagnostics

Each discovered palette setting records the requested color and the value
read immediately from the color input itself after the write. A mismatch is a
failed setting result (`palette-write-readback-mismatch`); a visible swatch is
not used as a substitute for that input readback. The later saved-value check
remains a separate persistence assertion.

On a Mac/front run, `scripts/front-style-only.mjs` searches external linked
stylesheets, inline `<style>` blocks, and the target instance's inline style
attributes for the run's written palette colors by default. It recognizes
rgb/rgba, 3/6/8-digit hex, and hsl/hsla forms with alpha in [0, 1]. One unified
result classifies a computed-style match as `found-on-element` (pass), a
matching instance-scoped CSS rule without a rendered match as
`instance-scoped-css-only` (record, never pass), or no match as `absent` (fail).
The CSS-only result records selectors and properties in machine-readable JSON;
it never substitutes for the computed-style oracle. Use `--include-stylesheets
0` to disable CSS source inspection. `--exercise-states 1` optionally hovers and
focuses generic interactive descendants, temporarily opening and restoring
closed `<details>` elements, and records the state that first revealed a color.

Front style dimensions use a default 2 CSS-pixel tolerance with an exclusive
boundary, configurable per
profile as `styleSpec.tolerances.sizePx`; the boundary is exclusive, so a full
2px difference (30px vs 28px) remains a mismatch. Other numeric measurements use
`styleSpec.tolerances.px` (default 0.6). Color comparisons remain exact after
normalization. A style item may declare `scope.containerKind: "pagination"`;
its selector is then resolved only under the innermost semantic pagination
container inside the uniquely identified block instance.

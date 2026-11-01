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

If no declared property changes, selector candidates are retained as a
fallback inventory only and the associated style check is `na`; its JSON
contains a machine reason code. A human-facing result does not include which
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
snapshot and are not used as a substitute for the learned effect assertion.

## Palette readback and optional CSS-source diagnostics

Each discovered palette setting records the requested color and the value
read immediately from the color input itself after the write. A mismatch is a
failed setting result (`palette-write-readback-mismatch`); a visible swatch is
not used as a substitute for that input readback. The later saved-value check
remains a separate persistence assertion.

On a Mac/front run, `scripts/front-style-only.mjs --include-stylesheets 1`
optionally searches external linked stylesheets, inline `<style>` blocks,
inline style attributes, and computed CSS custom properties for the run's
written palette colors. It recognizes rgb/rgba, hex, and hsl/hsla forms with
valid alpha from 0 through 1. A stylesheet-only occurrence is emitted as a
`record` row (`written-color-stylesheet-only-match`); it never converts a
missing computed-style match inside the exact instance into a pass. The
default element scan remains the pass/fail oracle.

Front style dimensions use a default ±2 CSS-pixel tolerance, configurable per
profile as `styleSpec.tolerances.sizePx`; other numeric measurements use
`styleSpec.tolerances.px` (default 0.6). Color comparisons remain exact after
normalization. A style item may declare `scope.containerKind: "pagination"`;
its selector is then resolved only under the innermost semantic pagination
container inside the uniquely identified block instance.

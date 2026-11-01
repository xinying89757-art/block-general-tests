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
Color and font-size setting units are also detected automatically from their
declared unit/value kind or the written CSS value shape (for example a CSS
color token or a length unit). Unless a profile supplies an explicit
`styleEffect` override, the shared adapter derives the observable CSS
properties and creates one generic style check per setting/property. These
checks use the setting-unit id and property; their human name describes only
the function being checked.

For each write, the adapter now captures the target instance before and after
that individual apply, before the batch save, so two style settings in one
batch cannot claim each other's effects. The after snapshot resolves the
written CSS value in the editor canvas (including relative font sizes) and
learns only elements whose computed property changed to that value. Every
changed element path for that property is retained in the profile and checked
on the front. When onboarding sees a color/font-size-shaped inventory value,
the draft records a `pendingStyleEffects` entry; the setting adapter connects
it to its actual setting-unit id, then marks it learned or leaves it pending
with a machine reason.

The same discovery path composes writable units directly from inventory
controls that have not already been claimed by a capability setting. Color
inputs are considered present when either the input itself or its associated
visible picker surface is rendered; editor color pickers may keep their
backing text input hidden. CSS color values and font-size-shaped control/value
types select the generic unit kind, while an explicit different CSS property
(such as width) excludes a dimension from font-size discovery. Each generated
unit is located by its profile requirement (region, occurrence, control type
and identity), writes a deterministic alternate value, checks the saved value,
and provides an initial-value restore operation. Existing capability-owned
controls are excluded by persisted-control references so their assertions
remain authoritative. Onboarding stores the generated requirement and binds
matching pending effects by region and control identity.

An unlearned automatic check is `na` in the machine report with its reason;
the human-facing summary does not show selector matches or compatibility
details. Candidate selectors are only drawn from that block's own canvas
snapshot and are not used as a substitute for the learned effect assertion.

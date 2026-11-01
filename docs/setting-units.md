# Shared setting units

Fresh-flow settings use one common unit per independently asserted setting. Capability modules keep their exported `freshSettings` entry points; `registerFreshSettingsCapability()` is the compatibility wrapper that lifts their existing definitions into units. It preserves the existing apply, editor assertion, restore callback, alternate value, and persisted-control references. The old baseline/restore runner is not routed through this interface.

## Unit shape

`createSettingUnit()` validates the shared contract:

```js
{
  id, capability, requirementId,
  locate: { source: 'requirement-profile', id: requirementId },
  lifecycleSurface: 'settings-dialog' | 'canvas-popover' | 'right-rail-flyout' | 'whole-list' | 'front-only',
  dependencies: [], persistedControls: [], alternateValue,
  apply(context), editorCheck(context), frontCheck?(context), frontRequires: [], restore(context)
}
```

The unit's `requirementId` resolves to the block's `requirements.capabilities` profile entry. Existing capability setting IDs map to the generic requirement IDs; no site or block identity is part of the mapping. Controls are still discovered by the capability's existing structural recognizer. A unit whose control cannot be identified uniquely fails closed. `persistedControls` is the exact subset used by post-publish readback.

The current fresh adapter passes each unit to the existing `planSettingBatches()` / `executeSettingBatches()` path. Declared unit dependencies keep related settings in separate batches; capability metadata continues to declare `requiresBaseline` restore points. The batch runner still owns one save per batch, per-setting assertions, failed-setting reruns, and final restore/retain policy.

## Migrated setting definitions

These six capability exports now return units behind their existing entry point: button-link, product-category-select, custom-filter-fields, product-list-display, block-color-scheme, and module-width. Category selection is one `whole-list` unit. Existing expected values and check callbacks are carried through unchanged. `block-style-spec` remains a check-only capability.

## Generic profile-defined units

- `createProfileRadioSettingUnit()` supports profile-declared radio settings such as expand/collapse and enable toggles. The profile supplies the option values, alternate value, requirement identity, lifecycle surface, and dependencies; a runner supplies `profileEditorAdapter.read/write`. A missing declaration is reported as `not-applicable`. A declaration without a usable adapter or unique option inventory is `not-adapted`, never pass.
- A `pld-product-count` requirement creates a front-only total-count check. It requires pagination off, a complete profile AUTOTEST product fixture, and a front reader. Its oracle reuses the existing rule: every fixture product must be present and the rendered count must fit the configured quantity; unrelated site products are allowed. No whole-site exact equality is used.
- Each profile `fixed-front` requirement creates a front-only exact-value unit. It invokes `readFrontValue` with the profile's `frontAssertion`; the shared oracle compares the observed value with the profile's `fixedValue`. If the box has no front reader the result is `deferred`; if Mac/front access exists but the profile has no `frontAssertion`, the result is `skip` with that reason.

The 47748 profile already declares `pld-product-count` and three fixed-front values, so its box fresh-flow reports those front checks as deferred. The 47748 inventory does not show the expand/collapse or enable pair. The 40838 inventory does show labels “默认展开/默认收起/不开启/开启”, but the controls share the same `target` name and the inventory notes that their setting ownership is uncertain; neither profile was changed to assert them. Confirm the unique groups and intended behavior before adding those profile requirements.

## Validation

`tests/setting-units.test.mjs` covers contract validation, compatibility wrapping, whole-list lifecycle, profile radio apply/check/restore, exact fixed-value front checks, not-applicable/deferred reporting, and AUTOTEST-only total-count semantics.

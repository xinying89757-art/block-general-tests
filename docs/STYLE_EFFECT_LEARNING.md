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
Capabilities without a profile `styleEffect` keep their existing setting and
style-check behavior.

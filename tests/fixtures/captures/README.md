# Real instance finder fixtures (G71)

Generated with `scripts/fixture-from-capture.mjs` from the supplied
`reports/capture-47498-1793539494` and `reports/capture-47748-1793539494`
PC/mobile captures. Each manifest records the exact source JSON SHA-256 and
viewport. Generated with `--replay-observations 1`, HTML/CSS preserve captured
structure, visibility and geometry; failed image sources keep natural size zero; remote requests, handler code, scripts, form destinations,
and editor-only serialized setting/storage metadata are excluded.

| Capture | Content images | Existing option labels | Hierarchy levels |
| --- | ---: | ---: | --- |
| 47498 PC/mobile | 0 | 22 | absent |
| 47748 PC/mobile | 20 img | 0 | absent |

The second capture contains one category link plus an arrow, **no child list**,
and a separate numeric pagination list. It cannot prove child hierarchy or
leaf typography. The first capture has no category list. Tests require an `na`
verdict for missing hierarchy rather than inferring levels from an arrow,
filter toolbar, result count, compare controls or pagination.

These fixtures test both candidate membership and measurement availability.
Original product images have zero natural dimensions and no size attributes;
they remain unavailable image-ratio observations, even though their rendered
alt-text boxes are measurable. The square media frame is recorded as selection
evidence, never substituted for actual image measurements. G70 had fabricated
loadable SVG natural dimensions and replayed 22 live options as 20; see
`docs/FINDER_CAPTURE_GAP.md` for the evidence and correction. Authoritative
geometry/visibility is an observed-state replay, not a full CSS/SVG layout engine.

Positive hierarchy variants clone the captured category list at test runtime,
then introduce nested children or sibling attribute/class/indent depth. Image
negatives and JS-bound options likewise reuse captured nodes. No handcrafted
replacement page is used by these regression tests. The unmodified four
fixtures are always checked first. No interactions are executed by the finder.

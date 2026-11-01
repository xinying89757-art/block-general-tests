# Real instance finder fixtures (G70)

Generated with `scripts/fixture-from-capture.mjs` from the supplied
`reports/capture-47498-1793538189` and `reports/capture-47748-1793538189`
PC/mobile captures. Each manifest records the exact source JSON SHA-256 and
viewport. HTML/CSS preserve captured structure and rule targets, using inert
image placeholders; remote requests, handler code, scripts, form destinations,
and editor-only serialized setting/storage metadata are excluded.

| Capture | Content images | Existing option labels | Hierarchy levels |
| --- | ---: | ---: | --- |
| 47498 PC/mobile | 0 | 20 | absent |
| 47748 PC/mobile | 20 img | 0 | absent |

The second capture contains one category link plus an arrow, **no child list**,
and a separate numeric pagination list. It cannot prove child hierarchy or
leaf typography. The first capture has no category list. Tests require an `na`
verdict for missing hierarchy rather than inferring levels from an arrow,
filter toolbar, result count, compare controls or pagination.

These fixtures test candidate membership and structural evidence, not final
pixel geometry or image-ratio conformity. Original product images had zero
natural dimensions in the capture; inert placeholders preserve available
rendered dimensions and may make unloaded sources measurable. Final front
checks still use real natural/attribute/rendered measurements and unchanged
profile ratio expectations. The manifest lists generator limitations.

Positive hierarchy variants clone the captured category list at test runtime,
then introduce nested children or sibling attribute/class/indent depth. Image
negatives and JS-bound options likewise reuse captured nodes. No handcrafted
replacement page is used by these regression tests. The unmodified four
fixtures are always checked first. No interactions are executed by the finder.

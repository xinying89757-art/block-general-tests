# Known front-end findings

## Mobile product-card overflow observed in a front-style report

The Mac front-style run in
`/workspace/mac-reports/front-style-47748-1793505240022.json` observed a layout
issue at a 375px viewport: document width was 505px and product-card content
extended beyond the block. The report recorded 10 sticking-out elements,
including product cards, images, and product-detail content. This is recorded
as a front-end finding; the automation keeps the existing mobile layout
assertion unchanged. Recheck the current published page before filing or
closing a product defect.

## Palette colors on block 47498: editor effect confirmed, front result unresolved

The G51 settings report records the three palette writes and post-save values
as `rgb(208, 182, 71)`, `rgb(13, 13, 10)`, and `rgb(17, 13, 9)`. A read-only
Products editor inspection on 2026-11-01 reopened only instance
`rAfbpBFNQHvy`; the color controls read back those same values, and the
instance canvas computed-style snapshot found the first value in text/border
styles and the latter two in background styles. The inspection explicitly
records `settingsChanged`, `pageSaved`, and `published` as false.

The Mac front report
`/workspace/mac-reports/front-style-47498-1793507386146.json` found none of
the three written colors among 296 elements using the then-current text,
background, and border color scan. This rules out a color-input parsing error
and shows the palette has a visible effect in the editor canvas, but does not
establish whether those saved values reached the published page. The front
runner now checks SVG fill/stroke, outline, shadows, gradients, and pseudo
elements too. Treat the Mac front result as unresolved until it is rerun with
that expanded reader; do not attribute it to a block defect or weaken the
written-value assertion without that evidence.

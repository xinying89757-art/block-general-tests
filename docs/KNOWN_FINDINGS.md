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

## G54 read-only palette comparison and Mac stylesheet evidence

The latest Mac reports (`front-style-47498-1793509038406.json` and
`front-style-47748-1793509050490.json`) still show three written-color misses
for 47498 (0/296 elements) and mobile overflow findings; the 47498 button text
row is `na` because its current-value inventory is not unique. A read-only
Products editor inspection of 47498 instance `rAfbpBFNQHvy` at
`reports/g48-style-inspection-47498-1793509330398.json` again read the persisted
palette values as `rgb(208, 182, 71)`, `rgb(13, 13, 10)`, and
`rgb(17, 13, 9)`. The exact instance canvas snapshot contains those values in
29, 2, and 2 style rows respectively. The probe changed no setting, saved no
page, and published nothing. Thus control readback and editor-canvas effects
are confirmed; whether the published page's external CSS contains or applies
them remains unresolved until the optional stylesheet search is run on the
Mac. Stylesheet-only text matches are diagnostic records, not a passing
computed-style assertion.

## Front findings from the 2026-11-01 Mac rerun

- At a 375px viewport, the Products document measured 505px wide and product
  cards overflowed the viewport. Keep the mobile overflow assertion as a real
  finding; this is page-level evidence and should be rechecked before filing.
- For block 47748, the non-current pagination item rendered `#4d4f53` where the
  design spec expects `#898989`. Keep this as a design mismatch; do not infer a
  palette-control or selector defect from it.
- For block 47498, the second and third saved palette colors
  (`rgb(13, 13, 10)` and `rgb(17, 13, 9)`) were not found on the public front
  instance in the Mac scan. The editor controls and canvas read them back, so
  this is recorded as “saved but not on front”; the available evidence does
  not identify whether the cause is publication, external CSS, or block scope.
- The 47748 pagination size comparison uses the shared size tolerance. A 30px
  measurement against 28px expected is exactly at the configured boundary and
  remains a fail; record the actual measurement rather than rounding it away.

## G71 — captured media unavailable; missing hierarchy/options are state evidence

The new PC/mobile captures for the example product-list instance have 20 img
nodes with zero natural size and no width/height attributes. Small alt-text
boxes coexist with larger media frames; no alternative loaded main image is
present. The offline evidence does not establish why those resources failed or
whether another machine can load them. Image-ratio conformity remains unknown,
not a measured ratio defect or a pass derived from the frame. The category
subtree and selectable field options are absent inside that captured instance;
later lazy loading/outside-root markup is unproven. G70's loaded SVG substitutes
and altered option visibility were fixture defects, not evidence of site fixes.
See `docs/FINDER_CAPTURE_GAP.md` and the G71 offline report for source counts.

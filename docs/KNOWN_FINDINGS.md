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

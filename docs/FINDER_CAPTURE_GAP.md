# G71: capture fixtures versus live finder evidence

## Evidence before the fix (offline, 2026-11-01)

Inputs: front-style-47748-1793539513421.json,
front-style-47498-1793539494116.json, and PC/mobile JSON inside the two
capture-*-1793539494 directories. No site was accessed to make this diagnosis.

G70 proved candidate membership, not a valid image measurement. Its fixture
builder substituted successfully loaded SVGs using **rendered** dimensions even
when the captured image had zero natural dimensions. A failed image's alt-text
box thereby became a loadable image with invented intrinsic dimensions. The
original report still compared those small rendered boxes to the image-ratio
spec. The fixture assertion “20 candidates” could pass without catching this.

CSS replay also flattened original selector specificity when remapping rules to
captured node IDs. This changed visibility: the live 47498 report has **22**
options (20 existing native-control labels plus two non-native option labels),
while the G70 fixture test expected 20. Captured computed display/visibility and
rectangles must be replayed explicitly when testing captured-state behavior.

### What the new captures actually contain

| Instance | PC/mobile evidence | Safe conclusion |
| --- | --- | --- |
| 47748 images | 20 cards, one img per card, all natural dimensions 0, no width/height attributes; small rendered boxes 68–234 × 18–34; primary media frame around the first image is 234 × 234 on PC | There is no second loaded product image to select in this capture. Do not infer image pixels/aspect ratio from an alt-text box, or treat the square frame as proof of the image's intrinsic ratio. |
| 47748 category navigation | One category li plus an arrow, no child list/item or numeric depth metadata; the other list is numeric pagination | Child hierarchy is absent from the captured instance DOM, including hidden nodes. No child typography/expand verdict can be made. |
| 47748 filter | One text input and two hidden inputs; no native/ARIA/JS-bound option nodes | No option elements exist in this captured state; return a precise na, not a selector repair by guessing. |
| 47498 | No images or category list; 22 visible option labels in both live viewports | Keep no-image na and all 22 labels. |

The identities recorded on each root agree with the requested block/settingId.
Captures traverse hidden descendants too (47748: 474 retained elements out of
477; 47498: 294 of 296, excluding script/style-like nodes). An existing hidden
child list would therefore be observable. These root-only snapshots cannot
prove whether later lazy loading, another page state, or outside-root markup
would produce a tree; none of those hypotheses is established. No broad state
scan is reintroduced to manufacture missing content.

## Fix and regression contract

1. Rank eligible media **per card**, rather than accept every image or the first
   one. Primary-slot geometry, rendered area, intrinsic/attribute area and slot
   distance provide the evidence; secondary badges/banners get rejection
   reasons. Ambiguous primary choices remain unverified.
2. A failed/unloaded source without intrinsic/attribute dimensions is still a
   located image, but is not a measurable image. Its ratio is unavailable, not
   the rendered alt-text ratio. Known measured mismatches still fail; unknown
   images/ambiguous main selections cannot produce a pass.
3. The fixture builder has an observed-state replay mode. It preserves failed
   image loading and captured dimensions, display and visibility rather than
   inventing natural image sizes or trusting incomplete/cascade-flattened CSS.
4. New PC/mobile fixtures are generated from these new captures. Tests check
   measurements and live option counts as well as membership. Positive
   multi-image and hierarchy variants are explicitly derived from captured
   nodes, and are not claimed to exist in the original snapshots.

This changes finder/measurement accuracy, not spec expectations. Color and
text typography oracles, the no-line-height policy and mobile verdict rules
remain unchanged. Selector details remain in machine diagnostics only.

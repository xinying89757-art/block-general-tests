# Instance markup captures

`front-style-only` can save the exact instance's markup and style evidence for
building offline finder fixtures. Capture is off by default. On the front-check
machine, add `--capture-instance <new-directory>` to the usual command:

```sh
node scripts/front-style-only.mjs --block <id> --url '<front-page-url>' \
  --run-report <fresh-run.json> --capture-instance reports/capture-<run>
```

The block number and settingId come from the same arguments/run report used by
all front checks. The runner captures PC and mobile before checks,
then restores the PC viewport. It writes `pc.html`, `pc.json`, `pc.css` and the
corresponding `mobile.*` files. Use a separate directory for each run/instance.
The front report's `instanceCaptures` lists paths, counts, listener availability
and capture errors. A capture error is diagnostic and does not change an oracle.

HTML is a sanitized clone of the instance root, not the entire page. JSON holds
a flat tree with parent/child indexes, original root-relative paths, tags,
classes, attributes (maximum 200 characters per attribute value), rectangles,
computed display/visibility/cursor/background image and other compact layout
metadata. Elements receive capture-only node identities in the detached clone;
the live DOM is not changed. CDP `DOMDebugger.getEventListeners` adds event-type,
capture/passive/once metadata when available, with a bounded 1000-node scan.
Handler source, script locations and function bodies are never serialized.
Handlers delegated on ancestors outside the instance are not captured.

Matching CSS rules include inline styles, inline style attributes, linked and
preloaded stylesheets and imported rules. Cross-origin CSSOM failures use the
existing bounded stylesheet fetch/recovery path. Conditional rule wrappers and
matched node identities are retained, alongside sanitized source URLs and fetch
failure evidence. Missing CSS remains explicit; the capture does not claim that
an unreadable sheet was complete.

Scripts and inline event code, comments, embedded documents, password inputs,
input values, textarea contents, credential-like attributes/text, and URL
credentials/query strings are excluded or redacted. Long attributes are replaced
by an omission marker. Each text node is limited to 200 characters. Captures
contain public labels and block structure, so keep raw captures under ignored
`reports/`; only add reviewed, sanitized fixtures to `tests/fixtures/`.

Create offline pages without launching a browser:

```sh
node scripts/fixture-from-capture.mjs reports/capture-<run> tests/fixtures/<name>
# Or give one pc.json/mobile.json file as the first argument.
```

The generator writes `pc.html`/`pc.css`, `mobile.html`/`mobile.css` and a manifest.
It reconstructs HTML from typed tree rows, ignoring arbitrary `outerHTML`, and
remaps matching CSS to captured node identities so outside-instance ancestors
are not needed. Original network resources become inert data-image placeholders;
a CSP blocks scripts and outgoing requests. Captured natural image dimensions
are preserved. Tests can load a generated page with Playwright `page.goto()` at
the recorded viewport, then run the existing instance-root finders.

Original scripts are deliberately absent: event listeners are evidence, not
replayable code. To reproduce behavior later, add a small local handler matching
the recorded structure/state transition. Captured pseudo-state rules are mapped
to their matched nodes; geometry metadata remains available to spot differences
caused by missing outside-page layout or fonts. This is a finder fixture, not a
pixel-identical copy of the entire site.

Finder diagnostics are always available in front JSON under `finderDebug.pc`
and `.mobile`. Each
finder records considered/accepted/rejected counts, reason counts and a capped
list of decisions (80 per finder, maximum configurable 200 in the shared reader),
with omitted counts. The finders cover content images,
hierarchy, parent/leaf navigation and filter options. Relevant shaped elements
are retained before generic non-candidates when a list reaches its cap. These
paths/classes/decisions are machine/debug data only; human summaries do not show
selector matching. Capture and diagnostics do not change pass/fail rules.

## Capture-backed finder regression

`tests/fixtures/captures/` contains sanitized PC/mobile pages generated from
real captures. Manifest entries carry the source JSON SHA-256. Finder tests use
these unchanged pages plus explicit variants cloned from their real nodes;
fixture placeholder geometry is not evidence of image-ratio conformity.
The generator also omits editor-only serialized setting/storage metadata.

Content images are recognized within repeated media-and-label cards or semantic
content items. Natural dimensions take precedence over numeric width/height
attributes, then rendered dimensions. Pictures count once. Gradients, text-link
backgrounds, sprite offsets, ancillary icons and banners outside content are
excluded with rejection reasons. A block with no content images remains `na`.
Hierarchy requires nested levels or numeric/consistent sibling indentation
signals; a lone category arrow, pagination and filter controls do not invent
levels. Options include native labels and non-navigating, text-bearing JS-bound
links/labels, without executing their handlers. Empty results expose machine
absence reasons; selector details stay out of human summaries.

## Observed-state replay (default, G71)

```sh
node scripts/fixture-from-capture.mjs <capture-dir> <fixture-dir> --replay-observations 1
```

The CLI defaults to observed-state replay. It preserves captured display,
visibility and border-box geometry instead of relying on CSS whose original
selector specificity was lost during remapping. Failed/unloaded img resources
retain zero natural dimensions; their rendered alt-text boxes never become
synthetic natural image dimensions. `--replay-observations 0` keeps the older
CSS-only reconstruction for layout experiments, and must not be treated as
proof of live measurement availability. Manifests record the mode and source
capture hashes. SVG internals/animations and original scripts are not replayed.

Finder regression now checks loading/measurement availability as well as
candidate counts. A card yields one primary image, ranked by its primary media
slot and rendered/intrinsic area; secondary media and tied choices carry machine
reasons. An unreadable primary image is not replaced by a badge or by its square
container for aspect-ratio assertions. Known measured mismatches still fail;
unknown images prevent a pass. See [the capture/live gap evidence](FINDER_CAPTURE_GAP.md).

# Checking motion in the static HTML export, in a real browser

Jest proves what the generator writes. These scripts prove what a browser
does with it, through the same entry point the editor's download uses.

```bash
# from the repo root, after `yarn build` in the touched packages
node packages/teleport-test/scripts/html-motion/pack-site.cjs /tmp/html-motion
cp <any short all-intra clip>.mp4 /tmp/html-motion/site/clip.mp4   # ffmpeg -f lavfi -i testsrc=duration=3:size=640x360:rate=30 -g 1 clip.mp4
node packages/teleport-test/scripts/html-motion/verify-site.cjs /tmp/html-motion/site
```

`verify-site.cjs` serves the folder, then checks pinning, lanes, chapters,
anchors, entrances, the in-place stagger, hover, scroll-linked motion, video
scrubbing, reduced motion, a visitor without JavaScript and a blocked runtime
file. `EXPECT_HELD=stream` pins that the clip is streamed by the second
through MediaSource (a fragmented clip with a global `sidx`, what the media
worker makes); `EXPECT_HELD=memory` that it is held whole (any other clip).
`measure-scrub.cjs` reports, per browser, how soon the clip is scrubbable and
the seek lag during and after loading, for a plain and a fragmented clip. It needs a Playwright install; it borrows the editor repo's
(`teleport-gui/node_modules/playwright-core`), so the sibling checkout must exist.

`verify-transitions.cjs <out-dir>` packs a two-page site per page-transition
setting and watches installed Chrome navigate it: forward and back direction,
the circle's origin, the cover sweep, a page that opted out, reduced motion and
"no transition". It needs a Chrome with cross-document View Transitions (126+).

```bash
node packages/teleport-test/scripts/html-motion/verify-transitions.cjs /tmp/html-transitions
```

`verify-next-transitions.cjs <out-dir> [node_modules]` packs the same site
(`transition-site.cjs`) as a Next project, runs `next build` and `next start`
against the node_modules of an installed generated Next project (Teleport &
Run's `packages/teleport-test/dist/teleport-project-next` by default), and
watches Chrome: the picture flying from a card onto its twin, the ordinary
transition where no picture flies and on the way back, a picture the next page
does not show, eight page changes in a row, and reduced motion.

```bash
node packages/teleport-test/scripts/html-motion/verify-next-transitions.cjs /tmp/next-transitions
```

`pack-uidl.cjs <project.json> <out-dir>` packs any exported project as a
static HTML site the way the editor's download does (embed parsing on). The
plain `yarn generate --project-type html` does not load the embed plugin, so it
fails on projects whose markup carries an embed.

`compare-next-html.cjs <next-origin> <html-origin> "/=index.html,/team=team.html"`
takes the same project running as a Next site and as a static site, puts every
scroll scene of every listed page at the same five scroll positions in both,
and reports each animated element whose opacity, movement, scale, position,
size, click-through or active chapter differs.

```bash
# the Next site from Teleport & Run on :3001, the static twin on :8098
node packages/teleport-test/scripts/html-motion/pack-uidl.cjs packages/teleport-test/dist/teleport-project-next.uidl.json /tmp/html-own
(cd /tmp/html-own/site && python3 -m http.server 8098) &
node packages/teleport-test/scripts/html-motion/compare-next-html.cjs http://localhost:3001 http://localhost:8098 "/=index.html"
```

`../link-shapes.cjs` measures, on a running generated Next site, how every
wrapped link renders against the editor's shape (no link element) and against
"the element becomes the anchor". Run it before changing how links are emitted.

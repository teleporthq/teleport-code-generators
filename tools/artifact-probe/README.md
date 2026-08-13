# artifact-probe

Does the generated project actually work?

The pipeline's evidence chain stops at the UIDL. Generator unit tests assert the
emitted code *contains* the right things; nothing has ever checked that the
result installs, builds, boots, renders, and is **visible**. So a project can
have a valid UIDL, a green test suite and a section that sits at `opacity: 0`
forever, and no artifact anywhere records that fact.

This produces the missing artifact: one JSON report per generated project.

## Why it lives outside `packages/`

Deliberately **not** a workspace package. It needs a browser driver
(`playwright-core`), and adding any dependency to the workspace re-resolves the
shared `yarn.lock` — which once silently changed `parse5` and broke an unrelated
package's build. Here it has its own `node_modules` and can touch nothing.

## Setup

```bash
cd tools/artifact-probe && npm install
```

No browser is downloaded. The probe drives a Chrome/Chromium already on the
machine; set `ARTIFACT_PROBE_BROWSER` to an executable path to override the
search.

## Use

```bash
node tools/artifact-probe/probe.mjs --project packages/teleport-test/dist/teleport-project-next
node tools/artifact-probe/probe.mjs --project <dir> --skip-install --max-routes 10
```

| Flag | Meaning |
| --- | --- |
| `--project <dir>` | generated project to probe (required) |
| `--report <path>` | report location. Defaults to `<project>.artifact-report.json` — **beside** the project, never inside it, because `yarn standalone` wipes the project tree on every file save |
| `--port <n>` | port for the production server (default 4321) |
| `--skip-install` | trust the existing `node_modules` |
| `--max-routes <n>` | cap routes probed (default 25) |
| `--no-screenshots` | skip full-page screenshots |
| `--email` / `--password` | credentials for protected routes (see below) |
| `--no-auth` | skip authentication entirely |
| `--json` | also print the report to stdout |

## Protected routes

Without a session the probe sees the sign-in page instead of every guarded
route — and it used to score that as a pass. A 37-route sweep once reported full
coverage when two thirds of it was the same login screen.

It now signs in first. Credentials come from `--email`/`--password`, then
`ARTIFACT_PROBE_EMAIL`/`ARTIFACT_PROBE_PASSWORD`, then a gitignored
`<project>.artifact-auth.json` beside the project — created on first run with a
test identity and a random per-project password. Nothing is hardcoded: this repo
is public, and the probe *creates* the account it is given, so a baked-in default
would put a known login on every generated site.

If sign-in fails the probe signs up through the real form and retries, so a
fresh database needs no manual setup. The app returns one error for both unknown
email and wrong password, so the sequence is what tells them apart: a sign-up
reporting "already exists" means the password is wrong, and that is reported
rather than silently continuing unauthenticated.

Three outcomes are kept distinct, because they need different actions:

| report says | means |
| --- | --- |
| `NOT VERIFIED → /sign-in` | no session — the probe never saw the page |
| `FORBIDDEN (role) → /` | signed in and refused. Sign-up creates role `user`; promote the account to `admin` in the database to reach `/admin/*` |
| `clean` | the route rendered itself and was actually inspected |

Exit code is 0 only when the artifact is clean.

## What it checks

**Build facts** — does `npm install` succeed, does `next build` succeed (with the
error text when it doesn't), per-route First Load JS, shared JS, declared
dependencies nothing imports.

Every run deletes `.next` first. That directory deliberately survives
regeneration so a dev server keeps its cache, which means it can hold artifacts
from an earlier `next dev` — and a production build over that mixture was
observed to emit **no stylesheet at all**, serving the CSS asset as HTTP 500 and
rendering every page unstyled. A probe that condemns a site because of its own
leftovers is worse than no probe, so the rebuild is unconditional.

**Runtime facts, in a real browser** — HTTP status per route, uncaught
exceptions, console errors, failed requests, and React hydration failures
(#418/#423/#425), which matter more than they look: when hydration dies,
*everything* the client was supposed to do dies with it, animations included.

**The visibility audit** — the one that catches the bug class nothing else can.
After load it looks for elements that occupy real space, contain text or images,
and cannot be seen (`opacity < 0.01`, `visibility: hidden`). Then it scrolls the
whole page and looks again. Content revealed by scrolling was a working in-view
animation; content still invisible after scrolling is a defect. Each finding
carries the nearest `data-thq` attribute, so it names the widget that produced it
instead of leaving you to guess which repo owns the problem.

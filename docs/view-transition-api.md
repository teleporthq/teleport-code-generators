# View Transition API — UIDL extension

This document describes the **View Transition API (VTA)** surface added to the teleport UIDL, the code that generators emit from it, and the UX hooks a visual editor should expose.

It is intended as a spec for an AI agent (or a human team) building the feature inside the TeleportHQ visual editor.

---

## 1. What it does

Page navigation becomes an animated transition instead of an instant swap. The generated app:

- Keeps elements like the navbar visually frozen across page changes.
- Plays a CSS animation on the page body (default preset: a book-page flip).
- Respects `prefers-reduced-motion` by default.
- Degrades gracefully in browsers without the API.

The feature is **opt-in per project** via `globals.pageTransition`, with **per-page opt-out** via `pageOptions.pageTransition.disabled`.

**v1 supports Next.js (pages router).** Other frameworks (React, Vue, HTML) plug in later without UIDL changes.

---

## 2. Mental model

The View Transition API is a browser feature with three moving parts:

1. **Snapshot**: `document.startViewTransition(cb)` takes a pixel screenshot of the current DOM ("old"), runs `cb` to mutate the DOM, takes a second screenshot ("new").
2. **Name**: any element with CSS `view-transition-name: foo` gets its own snapshot pair (`::view-transition-old(foo)` / `::view-transition-new(foo)`) and is lifted out of the root snapshot. Names must be unique.
3. **Animate**: the browser plays CSS animations on those pseudo-elements during navigation. `animation: none` freezes an element; a `@keyframes` animation makes it move.

Our UIDL names these three pieces:

- `globals.pageTransition` — global config: which preset, durations, easing, reduced-motion policy.
- `globals.pageTransition.regions` — which names animate vs. freeze, and (for custom) their keyframes.
- Elements carry their `view-transition-name` via the existing `style` dict.

---

## 3. UIDL schema additions

### 3.1 `globals.pageTransition: UIDLPageTransition`

```ts
interface UIDLPageTransition {
  preset?: 'book-flip' | 'fade' | 'slide' | 'custom' // default: 'book-flip'
  regions?: Record<string, UIDLPageTransitionRegion>
  duration?: { exit?: number; enter?: number }      // ms
  enterDelay?: number                                // ms
  easing?: { exit?: string; enter?: string }         // CSS easing
  reducedMotion?: 'instant' | 'respect-preset'       // default: 'instant'
  customCSS?: string                                 // appended after preset CSS
}

interface UIDLPageTransitionRegion {
  role: 'freeze' | 'animate'
  exit?:  { name?: string; keyframes?: Record<string, Record<string, string|number>>
            duration?: number; easing?: string; delay?: number }
  enter?: { name?: string; keyframes?: Record<string, Record<string, string|number>>
            duration?: number; easing?: string; delay?: number }
}
```

**Region semantics**

- Keys (e.g., `"navbar"`, `"main-page"`) match the `view-transition-name` values the user sets on their elements.
- `role: 'freeze'` → emits `::view-transition-old(name), ::view-transition-new(name) { animation: none; }`. Element stays pinned across the transition.
- `role: 'animate'` → emits `@keyframes` and `::view-transition-old/new(name) { animation: ... }`.
- If you pick a preset, its regions are merged in as defaults. Your `regions` entries override them.

**Default region names per preset**: `main-page` (animates), `navbar` + `page-stack` (freeze).

### 3.2 `pageOptions.pageTransition: UIDLPageTransitionOverride`

Per-page opt-out or per-page override, attached under a route value's `pageOptions`:

```ts
type UIDLPageTransitionOverride = UIDLPageTransition | { disabled: true }
```

`{ disabled: true }` keeps the navigation instant for that specific page (both to and from). A full `UIDLPageTransition` object would run a different animation for that page — supported by the schema, **not yet honored end-to-end in v1** (the generated `_app.js` only reads the disabled-paths set). Treat per-page override as "v1 supports only `{ disabled: true }`" for now; leave the richer shape in the editor's backlog.

### 3.3 Per-element `view-transition-name`

Plain CSS property on the element's `style`:

```json
{
  "type": "element",
  "content": {
    "elementType": "container",
    "style": {
      "view-transition-name": "main-page"
    }
  }
}
```

No new UIDL field. Names must be unique across the rendered page at snapshot time.

---

## 4. What the generator emits

For Next.js projects with `globals.pageTransition` set:

### 4.1 `pages/_document.js` — global CSS injection

A `<style data-vta-preset>...</style>` block in `<Head>` containing:

- `::view-transition-old(root), ::view-transition-new(root) { animation: none; }` (kills default crossfade).
- For each frozen region: `::view-transition-old(name), ::view-transition-new(name) { animation: none; }`.
- `@keyframes` for each animate region.
- `@media (prefers-reduced-motion: no-preference) { ... animations ... }` (unless `reducedMotion: 'respect-preset'`).
- `customCSS` appended verbatim at the end.

### 4.2 `pages/_app.js` — swap-point wrapper

```jsx
import { useState, useEffect, useRef } from 'react'
import { flushSync } from 'react-dom'
import { useRouter } from 'next/router'

const DISABLED_VTA_PATHS = new Set(['/some-disabled-path'])

export default function MyApp({ Component, pageProps }) {
  const router = useRouter()
  const [page, setPage] = useState({ Component, pageProps })
  const displayedPath = useRef(router.asPath)
  useEffect(() => {
    const nextPath = router.asPath
    const isNavigation = displayedPath.current !== nextPath
    const prevDisabled = DISABLED_VTA_PATHS.has(displayedPath.current)
    const nextDisabled = DISABLED_VTA_PATHS.has(nextPath)
    displayedPath.current = nextPath
    const swap = () => flushSync(() => setPage({ Component, pageProps }))
    if (
      isNavigation && !prevDisabled && !nextDisabled &&
      typeof document !== 'undefined' && document.startViewTransition
    ) {
      document.startViewTransition(swap)
    } else {
      setPage({ Component, pageProps })
    }
  }, [router.asPath, Component, pageProps])
  return (
    <>
      <Head>...</Head>
      <GlobalProvider>
        <page.Component {...page.pageProps} />
      </GlobalProvider>
    </>
  )
}
```

**Why `flushSync`**: React batches state updates by default. Inside the VTA callback the DOM must be mutated *synchronously* so the browser's "new" snapshot reflects the new page. Without `flushSync`, the two snapshots are identical and nothing animates.

---

## 5. Sample UIDLs

### 5.1 Minimal — book-flip preset, default names

The editor only has to set one field. Defaults give the user a working animation.

```json
{
  "name": "my-next-project",
  "globals": {
    "settings": { "title": "My site", "language": "en" },
    "meta": [],
    "assets": [],
    "pageTransition": { "preset": "book-flip" }
  },
  "root": {
    "name": "App",
    "stateDefinitions": {
      "route": {
        "type": "string",
        "defaultValue": "home",
        "values": [
          { "value": "home",  "pageOptions": { "componentName": "Home",  "navLink": "/" } },
          { "value": "about", "pageOptions": { "componentName": "About", "navLink": "/about" } }
        ]
      }
    },
    "node": { "type": "element", "content": { "elementType": "container" } }
  },
  "components": {
    "Home": {
      "name": "Home",
      "node": {
        "type": "element",
        "content": {
          "elementType": "container",
          "style": { "view-transition-name": "main-page" },
          "children": [{ "type": "static", "content": "Home page" }]
        }
      }
    },
    "About": {
      "name": "About",
      "node": {
        "type": "element",
        "content": {
          "elementType": "container",
          "style": { "view-transition-name": "main-page" },
          "children": [{ "type": "static", "content": "About page" }]
        }
      }
    }
  }
}
```

What the user needs to do in the editor:

1. Turn on "Page transitions" (a project-level toggle).
2. Pick a preset (`book-flip` is the default).
3. Tag the element that should flip with `view-transition-name: main-page` (or pick it from a dropdown — see §7).
4. Tag any layout elements that should freeze (navbar, page-stack) with matching names.

### 5.2 Tuned preset — custom timing + frozen sidebar

```json
{
  "globals": {
    "pageTransition": {
      "preset": "fade",
      "duration":  { "exit": 180, "enter": 180 },
      "enterDelay": 180,
      "easing":    { "exit": "ease-out", "enter": "ease-in" },
      "reducedMotion": "instant",
      "regions": {
        "sidebar": { "role": "freeze" }
      }
    }
  }
}
```

Then the element marked `view-transition-name: sidebar` stays pinned during navigation.

### 5.3 Full custom — author-defined keyframes

```json
{
  "globals": {
    "pageTransition": {
      "preset": "custom",
      "regions": {
        "main-page": {
          "role": "animate",
          "exit":  {
            "name": "my-exit",
            "duration": 400,
            "easing": "ease-in",
            "keyframes": {
              "from": { "transform": "scale(1)",   "opacity": 1 },
              "to":   { "transform": "scale(1.1)", "opacity": 0 }
            }
          },
          "enter": {
            "name": "my-enter",
            "duration": 400,
            "easing": "ease-out",
            "delay":  400,
            "keyframes": {
              "from": { "transform": "scale(0.9)", "opacity": 0 },
              "to":   { "transform": "scale(1)",   "opacity": 1 }
            }
          }
        },
        "navbar":     { "role": "freeze" },
        "page-stack": { "role": "freeze" }
      }
    }
  }
}
```

### 5.4 Per-page opt-out

Disable the animation when navigating to or from `/checkout` (commerce / cart flows often want instant feedback):

```json
"root": {
  "stateDefinitions": {
    "route": {
      "values": [
        { "value": "home" },
        {
          "value": "checkout",
          "pageOptions": {
            "navLink": "/checkout",
            "pageTransition": { "disabled": true }
          }
        }
      ]
    }
  }
}
```

### 5.5 Escape hatch — raw CSS

`customCSS` is appended verbatim after preset CSS. Use it to tweak a specific pseudo-element rule without abandoning the preset.

```json
{
  "globals": {
    "pageTransition": {
      "preset": "book-flip",
      "customCSS": "::view-transition-group(main-page) { z-index: 10; }"
    }
  }
}
```

---

## 6. Built-in presets

| Preset      | Animation                                               | Exit duration | Enter duration | Enter delay |
|-------------|---------------------------------------------------------|---------------|----------------|-------------|
| `book-flip` | Page sweeps away left like a turning book page          | 520 ms        | 300 ms         | 460 ms      |
| `fade`      | Old fades out, new fades in                             | 200 ms        | 200 ms         | 200 ms      |
| `slide`     | Old slides off left, new slides in from the right       | 300 ms        | 300 ms         | 300 ms      |
| `custom`    | No defaults — user provides keyframes per region        | —             | —              | —           |

All presets default to freezing `navbar` and `page-stack`, and animating `main-page`.

---

## 7. Suggested UX for the visual editor

The feature breaks down cleanly into four panels:

### 7.1 Project setting: "Page transitions"

A single toggle at the project level. When on, the editor sets `globals.pageTransition` to `{ preset: 'book-flip' }` and opens a detail panel.

### 7.2 Preset picker with previews

Show a 3-card grid: **Book flip** · **Fade** · **Slide** · (+ **Custom**). Each card plays a loop of the animation on hover. This is the 90% path — most users should never leave this screen.

### 7.3 Region panel

Three named regions by default (`main-page`, `navbar`, `page-stack`), each with:

- A role toggle: **Animate** · **Freeze** · **Unlisted**.
- For `animate`: duration, easing, enter-delay sliders; keyframes editor only when the user clicks "Customize".
- A "Pick element" button that attaches `view-transition-name: <region>` to an element on the canvas.

Let the user add/rename regions. A region must have a `view-transition-name` applied to at least one element, or it is dead code — flag it with a warning.

### 7.4 Per-page overrides

On each page's settings, one toggle: **Animate into this page** (default on). Off writes `pageOptions.pageTransition: { disabled: true }`.

### 7.5 Advanced panel

- Reduced motion: **Respect system** (default, writes `reducedMotion: 'instant'`) · **Always animate**.
- Custom CSS textarea (feeds `customCSS`).

### 7.6 Validation + warnings

- **Duplicate `view-transition-name`**: show an inline error on the second element. The browser falls back to the root snapshot when names collide.
- **Region defined but no element tagged**: warn in the region panel.
- **Element tagged but no matching region**: element will participate in the root crossfade (which we kill by default), so it will simply not animate. Warn that the region needs to exist.
- **Browser compatibility chip**: Chrome/Edge 111+, Safari 18+, Firefox behind a flag. Show a chip in the preset picker so users know what to expect. The generated code degrades gracefully, but preview-in-editor should work.

### 7.7 Canvas affordance

When the transitions panel is open, highlight any element on the canvas that has a `view-transition-name`. A small chip with the name + role (e.g., "main-page · Animate") helps users see which element belongs where.

---

## 8. What the feature does *not* do (yet)

- **Not yet: per-page alternate animations.** The UIDL schema accepts a per-page `UIDLPageTransition` but the Next.js generator only honors `{ disabled: true }` today. Hide the "different animation per page" affordance in the editor or mark it as preview.
- **Not yet: React / Vue / HTML generators.** Editor should either hide the toggle for non-Next projects or show a "coming soon" badge.
- **Not yet: structured CSS emission.** The preset CSS ships as a `<style>` blob injected via `customCode.head`. Users viewing the generated project stylesheet directly will not see the VTA rules there — they live in `_document.js`. This is invisible in the editor but worth knowing when supporting customers.

---

## 9. End-to-end test checklist

For a QA agent verifying the feature inside the editor + generated output:

- [ ] Create a two-page project; turn on transitions with the **book-flip** preset; tag the page root with `main-page` and the navbar with `navbar`.
- [ ] Build and run `next dev`; navigate home → about in Chrome; confirm the flip animation plays and the navbar does not move.
- [ ] Open the generated `pages/_document.js`; confirm `<style data-vta-preset>` is present and contains `@keyframes tlp-page-flip-exit` and `::view-transition-old(navbar)`.
- [ ] Open the generated `pages/_app.js`; confirm `document.startViewTransition` and `flushSync` are present, and `DISABLED_VTA_PATHS = new Set([])`.
- [ ] Mark the about page as disabled; regenerate; confirm `DISABLED_VTA_PATHS = new Set(['/about'])` and the animation no longer plays for that navigation.
- [ ] Switch to **custom** preset with no keyframes; confirm the editor blocks generation with a validation error (generator would throw `View Transition: animate region "main-page" has no keyframes.`).
- [ ] Enable `prefers-reduced-motion` in OS settings; confirm navigation is instant but still works.
- [ ] Test in Firefox (no VTA); confirm navigation still works (graceful fallback).

---

## 10. Reference files in this repo

- UIDL types: [packages/teleport-types/src/uidl.ts](../packages/teleport-types/src/uidl.ts)
- Preset resolver + CSS builder: [packages/teleport-plugin-common/src/view-transition/preset-css.ts](../packages/teleport-plugin-common/src/view-transition/preset-css.ts)
- Next.js project plugin (CSS injection): [packages/teleport-project-generator-next/src/view-transition/plugin.ts](../packages/teleport-project-generator-next/src/view-transition/plugin.ts)
- Next.js `_app.js` wrapper emission: [packages/teleport-project-generator-next/src/utils.ts](../packages/teleport-project-generator-next/src/utils.ts) (`configContentGenerator`, `buildViewTransitionBody`)
- UIDL validator decoders: [packages/teleport-uidl-validator/src/decoders/utils.ts](../packages/teleport-uidl-validator/src/decoders/utils.ts) (`pageTransitionDecoder`, `pageTransitionOverrideDecoder`)
- Integration tests: [packages/teleport-project-generator-next/__tests__/end2end/view-transition.ts](../packages/teleport-project-generator-next/__tests__/end2end/view-transition.ts)
- Preset unit tests: [packages/teleport-plugin-common/__tests__/view-transition/preset-css.ts](../packages/teleport-plugin-common/__tests__/view-transition/preset-css.ts)

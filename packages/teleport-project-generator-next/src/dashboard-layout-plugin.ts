import { FileType, ProjectPlugin, ProjectPluginStructure } from '@teleporthq/teleport-types'

const DASHBOARD_CSS = `
.teleport-dashboard-layout {
  display: flex;
  min-height: 100vh;
  width: 100%;
}

.teleport-dashboard-sidebar {
  /* Fixed column width on desktop. Without it the sidebar's width is
     content-driven (the generated <nav> ships an inline width:100% that
     overrides its own .navigation-sidebar{width:280px} rule), so while the
     content region is still empty during streaming the non-shrinkable sidebar
     dominates the row and hides the page content. The collapsed-rail rule
     (:has(#sidebar-expand-btn), above) hugs this to the icon-rail width, and
     the mobile (overlay) media query below overrides it. */
  width: var(--dashboard-sidebar-width, 280px);
  flex-shrink: 0;
  /* Bug 5.3 — stretch (the flex default for a row container) to match
     .teleport-dashboard-content's FULL height, whatever that is, instead of
     the previous fixed height:100vh. A flex item with a fixed 100vh height
     never grows with a taller sibling, so once page content exceeds one
     viewport height the sidebar's painted box simply stops after 100vh and
     whatever renders behind it shows for the rest of the scroll (run
     2026-07-07 "Edit Episode"). The sticky/scroll behaviour that USED to live
     here moves to the '> *' rule below, applied to the sidebar's own content
     (the AI nav root), so it still visually pins to the viewport while the
     OUTER box always spans the true full content height. */
  align-self: stretch;
  z-index: 200;
}

/* Bug 5.3 — the sidebar's own sticky/scroll behaviour lives on its immediate
   content (the AI-generated nav root), NOT on the outer .teleport-dashboard-
   sidebar wrapper (which now stretches to the full content height above).
   This is the "inner box" half of the fix: pinned to the viewport top, capped
   at one viewport height, independently scrollable if the nav itself is
   taller than that — while the outer wrapper's box keeps growing to match
   whatever the content column's real height ends up being. */
.teleport-dashboard-sidebar > * {
  position: sticky;
  top: 0;
  max-height: 100vh;
  overflow-y: auto;
  overflow-x: clip;
}

/* Bug 7 — the AI-authored nav root routinely ships with NO height at all
   despite the navigation prompt's explicit instruction to give its <tq-if>
   mode-wrapper "height: 100%" (which fills the <nav> host ONLY if that host
   itself has a definite height) — so it stays auto/content-sized (703px
   measured live) INSIDE the correctly Bug-5.3-stretched sidebar host (5094px
   measured live), leaving a large visible gap for the rest of the page's
   scroll (run 2026-07-07 "Add Tour Date" published site,
   https://fortunate-admirable-lyrebird-k28mpt.teleporthq.dev). This used to
   be scoped via nav[aria-label="Dashboard navigation"] — but the generated
   nav root never actually carries that aria-label (only an unrelated mobile
   overlay drawer does, aria-label="Mobile navigation"), so that selector
   silently never matched anything (confirmed live at
   https://grown-jaunty-kookabura-0ls4mo.teleporthq.dev — the "strange
   scrolling" report). Target the plain <nav> tag as a descendant of the
   sidebar instead: the nav-generation contract already mandates exactly one
   <nav> there, this reaches it through any number of display:contents
   wrapper divs, and it needs no aria-label / component-instance class name to
   match. Layered ALONGSIDE (not replacing) the '> *' rule above, which still
   matters for any other, non-<nav> direct content.

   height: 100vh (NOT max-height: 100vh — verified live: a max-height
   with no height leaves the box auto/content-sized, reproducing the exact
   703px symptom, since max-height only CAPS a box, it never makes it
   definite) is what actually fixes both halves of Bug 7: it forces nav's own
   painted box (which already carries its own background per the
   generation contract) to always span a full viewport height so there is
   never a gap, AND — just as importantly — gives nav a definite height so
   the AI's inner height: 100% mode-wrapper (see HEIGHT rule in
   navigation.ts) has something real to resolve against, instead of computing
   against an indeterminate auto-height parent (where percentage heights are
   spec'd to resolve to nothing). A min-height: 100% companion here was
   tried and reverted: since 100% reads off the OUTER stretched sidebar
   (which can be thousands of px on a long page), a min-height that large
   unconditionally wins over max-height: 100vh per the CSS min/max
   resolution order — verified live via a minimal repro — silently
   un-capping nav back to the full unstretched height and defeating the
   sticky/scroll behavior on exactly the long-page case this fix targets. */
.teleport-dashboard-sidebar nav {
  position: sticky;
  top: 0;
  height: 100vh;
  overflow-y: auto;
  overflow-x: clip;
}

.teleport-dashboard-content {
  flex: 1;
  min-width: 0;
  overflow-x: hidden;
  display: flex;
  flex-direction: column;
}

.teleport-dashboard-topbar {
  position: sticky;
  top: 0;
  z-index: 100;
  /* Hidden on desktop: it now hosts only the mobile sidebar toggle (no
     page-name title). Shown on mobile via the max-width:767px media query. */
  display: none;
  align-items: center;
  gap: 1rem;
  padding: 0.75rem 1.5rem;
  background: var(--color-surface, #ffffff);
  border-bottom: 1px solid var(--color-neutral, #e5e7eb);
}

.teleport-mobile-sidebar-toggle {
  display: none;
  background: none;
  border: none;
  cursor: pointer;
  padding: 0.5rem;
  color: var(--color-on-surface, #1f2937);
}

.teleport-dashboard-main {
  flex: 1;
}

.teleport-dashboard-page-title {
  font-size: 1.25rem;
  font-weight: 600;
  color: var(--color-on-surface, #1f2937);
  margin: 0;
}

.teleport-sidebar-scrim {
  display: none;
  position: fixed;
  inset: 0;
  z-index: 999;
  background: rgba(0, 0, 0, 0.5);
}

/* COLLAPSED SIDEBAR RAIL — width hug + right-side flyout escape.
   The three-mode nav's collapsed variant (state.sidebarMode === 'collapsed')
   is a narrow icon rail whose grouped items open a submenu FLYOUT to the right
   (position: absolute; left: 100%). That flyout is clipped away by the
   scrollable ancestors between it and the rail — the AI nav's own scroll area
   (overflow-y: auto) AND this wrapper (overflow-x: clip). A vertically
   scrollable box can never reveal horizontal overflow, so the panel vanishes
   underneath the rail. We detect the collapsed rail by its mandatory expand
   button (#sidebar-expand-btn — present ONLY in the collapsed <tq-if> branch)
   and, scoped to that rail only:
     1. hug the wrapper to the rail's own width so it no longer reserves the
        280px desktop column (which would otherwise leave a dead gap beside the
        icon rail once the fixed-width fallback no longer applies), and
     2. drop the overflow clipping on the rail and every descendant so the
        right-side flyout is fully visible next to the rail.
   The collapsed rail is icon-only and short, so trading its (rarely needed)
   internal scroll for a visible flyout is a safe exchange. Expanded and mobile
   views are untouched and keep their scroll. */
.teleport-dashboard-sidebar:has(#sidebar-expand-btn) {
  width: fit-content;
  overflow: visible;
}

.teleport-dashboard-sidebar:has(#sidebar-expand-btn) * {
  overflow: visible;
}

@media (max-width: 767px) {
  .teleport-dashboard-topbar {
    display: flex;
  }

  .teleport-mobile-sidebar-toggle {
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .teleport-dashboard-sidebar {
    position: fixed;
    left: 0;
    top: 0;
    height: 100vh;
    z-index: 1000;
    transform: translateX(-100%);
    transition: transform 0.3s ease;
  }

  .teleport-dashboard-sidebar.sidebar-open {
    transform: translateX(0);
  }

  .teleport-sidebar-scrim.scrim-visible {
    display: block;
  }
}

/* SELF-MANAGED SIDEBAR NAV — opt out of the platform mobile drawer.
   AI dashboard navigations are generated as a three-mode sidebar
   (state.sidebarMode = expanded | collapsed | mobile) that ships its OWN mobile
   experience: a position:fixed hamburger (#sidebar-mobile-open) plus a
   position:fixed full-screen overlay. The platform mobile drawer above must NOT
   take over for them. Its \`transform: translateX(-100%)\` turns
   .teleport-dashboard-sidebar into the CONTAINING BLOCK for those position:fixed
   descendants (a transformed ancestor anchors fixed children), shoving the
   nav's own trigger AND overlay off-screen with the wrapper — so the nav paints
   blank on mobile. We detect the self-managed nav by its mandatory
   #sidebar-mobile-open trigger and make the wrapper inert (no transform, no
   fixed column) so the nav's viewport-fixed trigger/overlay drive mobile. */
@media (max-width: 767px) {
  .teleport-dashboard-sidebar:has(#sidebar-mobile-open) {
    position: static;
    transform: none;
    transition: none;
    width: auto;
    height: auto;
    overflow: visible;
    z-index: auto;
  }

  /* Neutralize the Bug 5.3 inner sticky/scroll wrapper too — otherwise it
     would still clip/scroll-contain the self-managed nav's own position:fixed
     mobile overlay the same way the outer wrapper's overflow used to. */
  .teleport-dashboard-sidebar:has(#sidebar-mobile-open) > * {
    position: static;
    max-height: none;
    overflow: visible;
  }

  /* The self-managed nav supplies its own hamburger + overlay backdrop, so the
     platform's redundant topbar toggle and scrim must not appear — otherwise a
     second hamburger shows and the scrim's .sidebar-open would re-introduce the
     trapping transform. Scoped from :root so it matches wherever the topbar /
     scrim live (inside the layout, a sibling of it, or appended to <body>). */
  :root:has(.teleport-dashboard-sidebar #sidebar-mobile-open) .teleport-dashboard-topbar,
  :root:has(.teleport-dashboard-sidebar #sidebar-mobile-open) .teleport-sidebar-scrim {
    display: none !important;
  }
}

@media print {
  .teleport-dashboard-layout {
    display: block;
  }
  .teleport-dashboard-sidebar,
  .teleport-mobile-sidebar-toggle,
  .teleport-sidebar-scrim,
  .teleport-dashboard-topbar {
    display: none !important;
  }
  .teleport-dashboard-content {
    margin: 0;
    width: 100%;
  }
}
`.trim()

export class NextDashboardLayoutPlugin implements ProjectPlugin {
  async runBefore(structure: ProjectPluginStructure): Promise<ProjectPluginStructure> {
    return structure
  }

  async runAfter(structure: ProjectPluginStructure): Promise<ProjectPluginStructure> {
    const { uidl, files } = structure
    const pageLayoutMode = (uidl as unknown as Record<string, unknown>).pageLayoutMode
    if (pageLayoutMode !== 'dashboard') {
      return structure
    }

    const stylesheetEntry = files.get('projectStyleSheet')
    if (stylesheetEntry && stylesheetEntry.files.length > 0) {
      const cssFile = stylesheetEntry.files.find(
        (f) => f.fileType === FileType.CSS || f.fileType === 'css'
      )
      if (cssFile) {
        cssFile.content = cssFile.content + '\n\n' + DASHBOARD_CSS
      } else {
        stylesheetEntry.files.push({
          name: 'style',
          fileType: FileType.CSS,
          content: DASHBOARD_CSS,
        })
      }
    } else {
      files.set('projectStyleSheet', {
        path: ['pages'],
        files: [
          {
            name: 'style',
            fileType: FileType.CSS,
            content: DASHBOARD_CSS,
          },
        ],
      })
    }

    return structure
  }
}

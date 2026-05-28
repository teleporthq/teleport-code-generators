import { FileType, ProjectPlugin, ProjectPluginStructure } from '@teleporthq/teleport-types'

const DASHBOARD_CSS = `
.teleport-dashboard-layout {
  display: flex;
  min-height: 100vh;
  width: 100%;
}

.teleport-dashboard-sidebar {
  flex-shrink: 0;
  height: 100vh;
  position: sticky;
  top: 0;
  overflow-y: auto;
  overflow-x: hidden;
  z-index: 200;
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
  display: flex;
  align-items: center;
  gap: 1rem;
  padding: 0.75rem 1.5rem;
  background: var(--color-surface, #ffffff);
  border-bottom: 1px solid var(--color-neutral, #e5e7eb);
}

.teleport-mobile-sidebar-toggle {
  display: none;
  align-items: center;
  justify-content: center;
  background: none;
  border: none;
  cursor: pointer;
  padding: 0.5rem;
  font-size: 1.5rem;
  line-height: 1;
}

.teleport-sidebar-scrim {
  display: none;
  position: fixed;
  inset: 0;
  z-index: 999;
  background: rgba(0, 0, 0, 0.5);
}

@media (max-width: 767px) {
  .teleport-mobile-sidebar-toggle {
    display: flex;
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

@media (max-width: 991px) and (min-width: 768px) {
  .teleport-dashboard-sidebar {
    width: 64px !important;
  }

  .teleport-dashboard-sidebar .sidebar-link-text,
  .teleport-dashboard-sidebar .navigation-brand,
  .teleport-dashboard-sidebar tq-company-logo,
  .teleport-dashboard-sidebar .navigation-logo {
    display: none;
  }
}

@media print {
  .teleport-dashboard-sidebar,
  .teleport-mobile-sidebar-toggle,
  .teleport-sidebar-scrim {
    display: none !important;
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

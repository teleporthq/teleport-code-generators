import { GeneratedFolder } from '@teleporthq/teleport-types'

export const DEFAULT_TEMPLATE: GeneratedFolder = {
  name: 'teleport-project',
  files: [],
  subFolders: [],
}

export const DEFAULT_PACKAGE_JSON = {
  name: 'teleportHQ Project',
  version: '1.0.0',
  description: 'Project generated based on a UIDL document',
}

export const DEFAULT_GITIGNORE = ['node_modules', 'dist', '.env'].join('\n')

export const MAINTENANCE_NOTE_FILE_NAME = 'MAINTENANCE'

export const maintenanceNote = (projectName: string) => `# Maintaining ${projectName}

This project was generated with the [TeleportHQ code generators](https://github.com/teleporthq/teleport-code-generators).

- This is a copy. It does not change after it is generated: fixes and newer library versions reach it only when you apply them or generate the project again.
- \`package.json\` lists every library the project installs. After \`npm install\`, run \`npm audit\` to check them for known vulnerabilities and \`npm sbom --sbom-format cyclonedx\` to list them as a bill of materials (the command needs npm 10.2 or newer, or 9.9 on the 9.x line).
- The framework and library versions are the ones the generators target, which are not always the newest. Review and upgrade them as part of your own maintenance.
- Pages can also load scripts, styles and fonts from other hosts, such as a CDN or a font service. Search the code for \`https://\` to find them.
`

export const DEFAULT_ROUTER_FILE_NAME = 'index'

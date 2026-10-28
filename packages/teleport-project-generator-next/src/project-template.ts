import { FileType, GeneratedFolder } from '@teleporthq/teleport-types'

const projectTemplate: GeneratedFolder = {
  name: 'teleport-project-next',
  files: [
    {
      name: 'package',
      content: `
{
  "name": "teleport-project-next",
  "version": "1.0.0",
  "description": "A next project generated based on a UIDL document",
  "main": "index.js",
  "scripts": {
    "dev": "next",
    "build": "next build",
    "start": "next start",
    "export": "next export"
  },
  "author": "TeleportHQ",
  "license": "MIT",
  "dependencies": {
    "@teleporthq/react-components": "1.0.13",
    "next": "^12.3.7",
    "react": "^17.0.2",
    "react-dom": "^17.0.2"
  },
  "engines": {
      "node": ">=20.x"
  }
}`,
      fileType: FileType.JSON,
    },
  ],
  subFolders: [],
}

export default projectTemplate

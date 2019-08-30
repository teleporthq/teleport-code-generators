export default {
  name: 'teleport-project-stencil',
  files: [
    {
      name: 'package',
      content: `
{
  "name": "teleport-project-stencil",
  "private": true,
  "version": "1.0.0",
  "author": "teleporthq.io",
  "description": "A stencil project generated based on a UIDL document",
  "scripts": {
    "build": "stencil build",
    "start": "stencil build --dev --watch --serve"
  },
  "dependencies": {
    "@stencil/core": "^1.2.1",
    "@stencil/router": "^1.0.1"
  }
}`,
      fileType: 'json',
    },
    {
      name: 'stencil.config',
      content: `
import { Config } from '@stencil/core';

export const config: Config = {
  outputTargets: [
    {
      type: 'www',
      // comment the following line to disable service workers in production
      serviceWorker: null,
      baseUrl: 'https://myapp.local/'
    }
  ]
};`,
      fileType: 'ts',
    },
    {
      name: 'tsconfig',
      content: `
{
  "compilerOptions": {
    "allowSyntheticDefaultImports": true,
    "allowUnreachableCode": false,
    "declaration": false,
    "experimentalDecorators": true,
    "lib": [
      "dom",
      "es2015"
    ],
    "moduleResolution": "node",
    "module": "esnext",
    "target": "es2017",
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "jsx": "react",
    "jsxFactory": "h"
  },
  "include": [
    "src"
  ],
  "exclude": [
    "node_modules"
  ]
}`,
      fileType: 'json',
    },
  ],
  subFolders: [
    {
      name: 'src',
      files: [
        {
          name: 'index',
          content: `
export * from './components';
import '@stencil/router';`,
          fileType: 'ts',
        },
      ],
      subFolders: [],
    },
  ],
}

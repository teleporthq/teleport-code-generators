export default {
  name: 'teleport-project-preact-codesandbox',
  files: [
    {
      name: 'package',
      content: `
{
  "private": true,
  "name": "teleport-project-preact",
  "version": "1.0.0",
  "description": "A preact project generated based on a UIDL document",
  "author": "teleporthq.io",
  "scripts": {
    "start": "per-env",
    "start:production": "npm run -s serve",
    "start:development": "npm run -s dev",
    "build": "preact build --template src/index.html",
    "serve": "npm run build && preact serve",
    "dev": "preact watch --template src/index.html",
    "lint": "eslint src"
  },
  "eslintConfig": {
    "extends": "eslint-config-synacor"
  },
  "eslintIgnore": [
    "build/*"
  ],
  "devDependencies": {
    "eslint": "^4.9.0",
    "eslint-config-synacor": "^2.0.2",
    "identity-obj-proxy": "^3.0.0",
    "per-env": "^1.0.2",
    "preact-cli": "^2.1.0",
    "preact-render-spy": "^1.2.1"
  },
  "dependencies": {
    "preact": "^8.2.6",
    "preact-router": "^2.5.7",
    "preact-compat": "3.19.0",
    "react-helmet": "^5.2.1"
  }
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
import { render } from "preact";
import App from "./components/app";

render(<App />, document.body);
`,
          fileType: 'js',
        },
      ],
      subFolders: [],
    },
  ],
}

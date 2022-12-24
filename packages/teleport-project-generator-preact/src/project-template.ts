export default {
  name: 'teleport-project-preact',
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
    "dev": "preact watch --template src/index.html",
    "lint": "eslint src",
    "serve": "sirv build --port 8080 --cors --single"
  },
  "eslintConfig": {
    "extends": "preact",
    "ignorePatterns": [
      "build/"
    ]
  },
  "devDependencies": {
    "enzyme": "^3.10.0",
    "enzyme-adapter-preact-pure": "^2.0.0",
    "eslint": "^6.0.1",
    "eslint-config-preact": "^1.1.0",
    "jest": "^24.9.0",
    "jest-preset-preact": "^1.0.0",
    "preact-cli": "^3.3.5",
    "sirv-cli": "1.0.3"
  },
  "dependencies": {
    "preact": "^10.3.2",
    "preact-render-to-string": "^5.1.4",
    "preact-router": "^3.2.1"
  }
}`,
      fileType: 'json',
    },
    {
      name: '.babelrc',
      content: `
{
  "env": {
    "test": {
      "presets": [
        ["preact-cli/babel", { "modules": "commonjs" }]
      ]
    }
  }
}`,
    },
  ],
  subFolders: [
    {
      name: 'src',
      files: [
        {
          name: 'index',
          content: `
import App from "./components/app";

export default App;`,
          fileType: 'js',
        },
      ],
      subFolders: [],
    },
  ],
}

export default {
  name: 'teleport-project-react',
  files: [
    {
      name: 'package',
      content: `
{
  "name": "teleport-project-react",
  "version": "1.0.0",
  "private": true,
  "dependencies": {
    "@craco/craco": "^7.0.0-alpha.0",
    "react": "^17.0.2",
    "react-dom": "^17.0.2",
    "react-router-dom": "^5.2.0"
  },
  "scripts": {
    "start": "craco start",
    "build": "craco build",
    "test": "craco test --env=jsdom",
    "eject": "craco eject"
  },
  "engines": {
    "node": "16.x"
  },
  "browserslist": {
    "production": [
      ">0.2%",
      "not dead",
      "not op_mini all"
    ],
    "development": [
      "last 1 chrome version",
      "last 1 firefox version",
      "last 1 safari version"
    ]
  },
  "devDependencies": {
    "react-scripts": "^5.0.1"
  }
}`,
      fileType: 'json',
    },
    {
      name: 'craco.config',
      fileType: 'js',
      content: `module.exports = {
  reactScriptsVersion: "react-scripts",
  style: {
    css: {
      loaderOptions: () => {
        return {
          url: false,
        };
      },
    },
  },
};`,
    },
  ],
  subFolders: [],
}

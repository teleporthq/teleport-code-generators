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
    "react": "^16.8.6",
    "react-dom": "^16.8.6",
    "react-router-dom": "5.0.1",
    "react-helmet": "^5.2.1",
    "react-scripts": "3.0.1"
  },
  "scripts": {
    "start": "react-scripts start",
    "build": "react-scripts build",
    "test": "react-scripts test --env=jsdom",
    "eject": "react-scripts eject"
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
  }
}`,
      fileType: 'json',
    },
  ],
  subFolders: [],
}

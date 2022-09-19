export default {
  name: 'teleport-project-gridsome',
  files: [
    {
      name: 'package',
      content: `
{
  "name": "teleport-project-template-gridsome",
  "version": "0.1.0",
  "description": "A simple starter to get up and developing quickly with Gridsome",
  "author": "teleportHQ",
  "private": true,
  "scripts": {
    "develop": "gridsome develop",
    "explore": "gridsome explore",
    "build": "gridsome build"
  },
  "dependencies": {
    "gridsome": "^0.7.0"
  }
}`,
      fileType: 'json',
    },
    {
      name: `gridsome-config`,
      fileType: 'js',
      content: `
// This is where project configuration and plugin options are located.
// Learn more: https://gridsome.org/docs/config

// Changes here require a server restart.
// To restart press CTRL + C in terminal and run gridsome develop

module.exports = {
  siteName: "TeleportProject",
  plugins: []
};
`,
    },
    {
      name: '.gitignore',
      content: `
*.log
.cache
.DS_Store
src/.temp
node_modules
dist
.env
.env.*
`,
    },
  ],
  subFolders: [
    {
      name: 'src',
      files: [
        {
          name: 'main',
          content: `
// This is the main.js file. Import global CSS and scripts here.
// The Client API can be used here. Learn more: gridsome.org/docs/client-api

export default function(Vue, { router, head, isClient }) {}
`,
          fileType: 'js',
        },
      ],
      subFolders: [],
    },
  ],
}

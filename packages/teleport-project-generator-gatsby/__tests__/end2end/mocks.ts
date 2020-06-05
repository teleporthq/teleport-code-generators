// tslint:disable
export default {
  name: 'teleport-project-gatsby',
  files: [
    {
      name: 'package',
      content: `
{
  "name": "teleport-project-tempalte-gatsby",
  "private": true,
  "description": "A simple starter to get up and developing quickly with Gatsby",
  "version": "0.1.0",
  "author": "teleportHQ",
  "dependencies": {
    "gatsby": "^2.15.36",
    "gatsby-image": "^2.2.27",
    "gatsby-plugin-offline": "^3.0.14",
    "gatsby-plugin-react-helmet": "^3.1.11",
    "gatsby-plugin-sharp": "^2.2.29",
    "gatsby-source-filesystem": "^2.1.31",
    "gatsby-transformer-sharp": "^2.2.21",
    "prop-types": "^15.7.2",
    "react": "^16.10.2",
    "react-dom": "^16.10.2",
    "react-helmet": "^5.2.1"
  },
  "devDependencies": {
    "prettier": "^1.19.1"
  },
  "keywords": [
    "gatsby"
  ],
  "license": "MIT",
  "scripts": {
    "build": "gatsby build",
    "develop": "gatsby develop",
    "format": "prettier --write \\"**/*.{js,jsx,json,md}\\"",
    "start": "npm run develop",
    "serve": "gatsby serve",
    "test": "echo \\"Write tests! -> https://gatsby.dev/unit-testing \\""
  }
}`,
      fileType: 'json',
    },
    {
      name: 'gatsby-node',
      content: ``,
      fileType: 'js',
    },
    {
      name: 'gatsby-config',
      fileType: 'js',
      content: `module.exports = {
  siteMetadata: {
    title: 'Teleport Gatsby Default Starter',
    description: 'Kick off your next, great Gatsby project.',
    author: 'teleportHQ',
  },
  plugins: [
    'gatsby-plugin-react-helmet',
    {
      resolve: 'gatsby-source-filesystem',
      options: {
        name: 'images',
        path: ${String('`${__dirname}/static/playground_assets`')}
      },
    },
    'gatsby-transformer-sharp',
    'gatsby-plugin-sharp',
    ],
}`,
    },
  ],
  subFolders: [
    {
      name: 'src',
      files: [],
      subFolders: [
        {
          name: 'images',
          files: [],
          subFolders: [],
        },
      ],
    },
  ],
}

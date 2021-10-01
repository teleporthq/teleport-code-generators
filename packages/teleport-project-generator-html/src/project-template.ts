export default {
  name: 'teleport-project-html',
  files: [
    {
      name: 'package',
      content: `
  {
    "name": "teleport-project-html",
    "version": "1.0.0",
    "private": true,
    "dependencies": {
        "parcel-bundler": "^1.6.1"
    },
    "scripts": {
        "start": "parcel index.html --open",
        "build": "parcel build index.html"
    }
  }`,
      fileType: 'json',
    },
  ],
  subFolders: [],
}

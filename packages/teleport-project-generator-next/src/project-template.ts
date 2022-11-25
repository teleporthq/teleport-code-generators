export default {
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
    "next": "^12.1.0",
    "react": "^17.0.2",
    "react-dom": "^17.0.2",
    "@lottiefiles/lottie-player": "1.6.0"
  }
}`,
      fileType: 'json',
    },
  ],
  subFolders: [],
}

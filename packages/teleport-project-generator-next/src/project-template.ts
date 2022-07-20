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
    "next": "^12.2.2",
    "react": "^18.2.0",
    "react-dom": "^18.2.0"
  }
}`,
      fileType: 'json',
    },
    {
      name: 'next.config',
      fileType: 'js',
      content: `module.exports = {
  reactStrictMode: true,
  experimental: {
    images: {
      allowFutureImage: true,
    },
  },
};`,
    },
  ],
  subFolders: [],
}

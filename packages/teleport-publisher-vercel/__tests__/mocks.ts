import { GeneratedFolder } from '@teleporthq/teleport-types'

export const projectFiles: GeneratedFolder = {
  name: 'project-name',
  files: [
    {
      name: 'package',
      fileType: 'json',
      content: `{
        "name": "my-app",
        "version": "0.1.0",
        "private": true,
        "scripts": {
          "dev": "next dev",
          "build": "next build",
          "start": "next start"
        },
        "dependencies": {
          "next": "12.0.10",
          "react": "17.0.2",
          "react-dom": "17.0.2"
        }
      }
      `,
    },
  ],
  subFolders: [
    {
      name: 'pages',
      files: [
        {
          name: 'index',
          fileType: 'js',
          content: `export default function Home() {
            return (
              <h1>
                Welcome to <a href="https://nextjs.org">Next.js!</a>
              </h1>
            );
          }
          `,
        },
      ],
      subFolders: [],
    },
    {
      name: 'static',
      files: [
        {
          location: 'remote',
          content: 'https://presentation-website-assets.vercel.app/logos/logo.png',
          name: 'poza.png',
        },
      ],
      subFolders: [],
    },
  ],
}

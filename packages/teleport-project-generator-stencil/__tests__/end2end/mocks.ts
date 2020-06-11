export default {
  name: 'stencil',
  files: [
    {
      name: 'stencil.config',
      content: `
import { Config } from '@stencil/core';

export const config: Config = {
namespace: 'app',
outputTargets: [
{
  type: 'www',
  // comment the following line to disable service workers in production
  serviceWorker: null,
  baseUrl: 'https://myapp.local/'
}
]
};`,
      fileType: 'ts',
    },
  ],
  subFolders: [
    {
      name: 'src',
      files: [],
      subFolders: [
        {
          name: 'components',
          files: [],
          subFolders: [],
        },
      ],
    },
  ],
}

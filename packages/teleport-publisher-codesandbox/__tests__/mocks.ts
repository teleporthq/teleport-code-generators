import { GeneratedFolder } from '@teleporthq/teleport-types'

export const createProjectFolder = (): GeneratedFolder => {
  return {
    name: 'root',
    files: [
      {
        content: '<asdasd>',
        name: 'root-file',
      },
    ],
    subFolders: [
      {
        name: 'src',
        files: [
          {
            name: 'file-1',
            content: 'asdasd-1',
          },
          {
            name: 'file-2',
            content: 'asdasd-2',
          },
        ],
        subFolders: [],
      },
    ],
  }
}

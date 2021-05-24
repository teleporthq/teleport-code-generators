import { Mapping } from '@teleporthq/teleport-types'

export const ReactNativeProjectMapping: Mapping = {
  elements: {
    navlink: {
      elementType: 'TouchableWithoutFeedback',
      dependency: {
        type: 'library',
        path: 'react-native-gesture-handler',
        version: '^1.10.3',
        meta: {
          namedImport: true,
        },
      },
    },
  },
}

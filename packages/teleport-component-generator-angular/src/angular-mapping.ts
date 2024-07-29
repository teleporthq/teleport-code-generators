import { Mapping } from '@teleporthq/teleport-types'

export const AngularMapping: Mapping = {
  elements: {
    fragment: {
      elementType: 'div',
      name: 'custom-fragment',
      style: {
        display: {
          type: 'static',
          content: 'contents',
        },
      },
    },
  },
  events: {},
  attributes: {},
}

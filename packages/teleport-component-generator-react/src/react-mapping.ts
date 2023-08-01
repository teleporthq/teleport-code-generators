import { Mapping } from '@teleporthq/teleport-types'

export const ReactMapping: Mapping = {
  elements: {
    group: {
      elementType: 'Fragment',
      dependency: {
        type: 'library',
        path: 'react',
        version: '^17.0.2',
        meta: {
          namedImport: true,
        },
      },
    },
    'contentful-richtext-node': {
      elementType: 'RichText',
      dependency: {
        type: 'package',
        path: '@madebyconnor/rich-text-to-jsx',
        version: '2.2.1',
      },
    },
    'caisy-richtext-node': {
      elementType: 'RichTextRenderer',
      dependency: {
        type: 'package',
        path: '@caisy/rich-text-react-renderer',
        version: '0.7.3',
        meta: {
          namedImport: true,
        },
      },
    },
    'markdown-node': {
      elementType: 'Markdown',
      dependency: {
        type: 'package',
        path: 'markdown-to-jsx',
        version: '7.2.0',
      },
    },
    'html-node': {
      elementType: 'DangerousHTML',
      dependency: {
        type: 'package',
        path: 'dangerous-html',
        version: '0.1.12',
        meta: {
          importAlias: 'dangerous-html/react',
        },
      },
    },
    'date-time-node': {
      elementType: 'DateTimePrimitive',
      dependency: {
        type: 'package',
        path: '@teleporthq/react-components',
        version: 'github:teleporthq/thq-react-components#b4a760af6b91e31d182a6a371e55fd984a770d82',
        meta: {
          namedImport: true,
        },
      },
    },
    'lottie-node': {
      elementType: 'Player',
      dependency: {
        type: 'package',
        path: '@lottiefiles/react-lottie-player',
        version: '3.4.7',
        meta: {
          namedImport: true,
        },
      },
    },
  },
  events: {
    click: 'onClick',
    focus: 'onFocus',
    blur: 'onBlur',
    change: 'onChange',
    submit: 'onSubmit',
    keydown: 'onKeyDown',
    keyup: 'onKeyUp',
    keypress: 'onKeyPress',
    mouseenter: 'onMouseEnter',
    mouseleave: 'onMouseLeave',
    mouseover: 'onMouseOver',
    select: 'onSelect',
    touchstart: 'onTouchStart',
    touchend: 'onTouchEnd',
    scroll: 'onScroll',
    load: 'onLoad',
  },
  attributes: {
    for: 'htmlFor',
    readonly: 'readOnly',
    class: 'className',
    contenteditable: 'contentEditable',
  },
  illegalClassNames: ['React', 'Fragment', 'ReactDOM', 'PropTypes'],
}

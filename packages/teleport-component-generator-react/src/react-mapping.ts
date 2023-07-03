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
        path: '@teleporthq/thq-react-components',
        version: '1.0.1',
        meta: {
          namedImport: true,
        },
      },
    },
    'date-time-node': {
      elementType: 'DateTimePrimitive',
      dependency: {
        type: 'package',
        version: '1.0.1',
        path: '@teleporthq/thq-react-components',
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

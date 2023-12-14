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
    'html-node': {
      elementType: 'Script',
      dependency: {
        type: 'package',
        path: 'dangerous-html',
        version: '0.1.13',
        meta: {
          importAlias: 'dangerous-html/react',
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
    srcset: 'srcSet',
  },
  illegalClassNames: ['React', 'Fragment', 'ReactDOM', 'PropTypes'],
}

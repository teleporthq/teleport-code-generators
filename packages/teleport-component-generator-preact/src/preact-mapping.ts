import { Mapping } from '@teleporthq/teleport-types'

export const PreactMapping: Mapping = {
  elements: {
    'html-node': {
      elementType: 'dangerous-html',
      dependency: {
        type: 'package',
        path: 'dangerous-html',
        version: '0.1.12',
        meta: {
          importJustPath: true,
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
    autoplay: 'autoPlay',
    readonly: 'readOnly',
    class: 'className',
    contenteditable: 'contentEditable',
  },
}

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
  illegalClassNames: ['React', 'Fragment', 'ReactDOM', 'PropTypes'],
}

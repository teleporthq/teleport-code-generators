import { Mapping } from '@teleporthq/teleport-types'

export const StencilMapping: Mapping = {
  elements: {
    'html-node': {
      elementType: 'dangerous-html',
      dependency: {
        type: 'package',
        path: 'dangerous-html',
        version: '0.1.10',
        meta: {
          importJustPath: true,
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
  illegalClassNames: ['Prop', 'State'],
  illegalPropNames: ['title'],
}

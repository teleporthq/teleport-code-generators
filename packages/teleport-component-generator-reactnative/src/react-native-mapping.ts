import { Mapping } from '@teleporthq/teleport-types'

export const ReactNativeMapping: Mapping = {
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
    container: {
      elementType: 'View',
      dependency: {
        type: 'library',
        path: 'react-native',
        version: '^0.64.1',
        meta: {
          namedImport: true,
        },
      },
    },
    form: {
      elementType: 'View',
      dependency: {
        type: 'library',
        path: 'react-native',
        version: '^0.64.1',
        meta: {
          namedImport: true,
        },
      },
    },
    text: {
      elementType: 'Text',
      dependency: {
        type: 'library',
        path: 'react-native',
        version: '^0.64.1',
        meta: {
          namedImport: true,
        },
      },
    },
    textblock: {
      elementType: 'Text',
      dependency: {
        type: 'library',
        path: 'react-native',
        version: '^0.64.1',
        meta: {
          namedImport: true,
        },
      },
    },
    heading1: {
      elementType: 'Text',
      dependency: {
        type: 'library',
        path: 'react-native',
        version: '^0.64.1',
        meta: {
          namedImport: true,
        },
      },
    },
    heading2: {
      elementType: 'Text',
      dependency: {
        type: 'library',
        path: 'react-native',
        version: '^0.64.1',
        meta: {
          namedImport: true,
        },
      },
    },
    heading3: {
      elementType: 'Text',
      dependency: {
        type: 'library',
        path: 'react-native',
        version: '^0.64.1',
        meta: {
          namedImport: true,
        },
      },
    },
    heading4: {
      elementType: 'Text',
      dependency: {
        type: 'library',
        path: 'react-native',
        version: '^0.64.1',
        meta: {
          namedImport: true,
        },
      },
    },
    heading5: {
      elementType: 'Text',
      dependency: {
        type: 'library',
        path: 'react-native',
        version: '^0.64.1',
        meta: {
          namedImport: true,
        },
      },
    },
    heading6: {
      elementType: 'Text',
      dependency: {
        type: 'library',
        path: 'react-native',
        version: '^0.64.1',
        meta: {
          namedImport: true,
        },
      },
    },
    link: {
      elementType: 'Text',
      dependency: {
        type: 'library',
        path: 'react-native',
        version: '^0.64.1',
        meta: {
          namedImport: true,
        },
      },
    },
    video: {
      elementType: 'null',
      ignore: true,
    },
    audio: {
      elementType: 'null',
      ignore: true,
    },
    iframe: {
      elementType: 'null',
      ignore: true,
    },
    image: {
      elementType: 'Image',
      attrs: {
        source: { type: 'dynamic', content: { referenceType: 'attr', id: 'src' } },
      },
      dependency: {
        type: 'library',
        path: 'react-native',
        version: '^0.64.1',
        meta: {
          namedImport: true,
        },
      },
    },
    button: {
      elementType: 'TouchableOpacity',
      dependency: {
        type: 'library',
        path: 'react-native',
        version: '^0.64.1',
        meta: {
          namedImport: true,
        },
      },
      children: [
        {
          type: 'element',
          content: {
            elementType: 'Text',
            dependency: {
              type: 'library',
              path: 'react-native',
              version: '^0.64.1',
              meta: {
                namedImport: true,
              },
            },
            name: 'button-text',
            children: [{ type: 'dynamic', content: { referenceType: 'children', id: 'children' } }],
          },
        },
      ],
    },
    textinput: {
      elementType: 'TextInput',
      dependency: {
        type: 'library',
        path: 'react-native',
        version: '^0.64.1',
        meta: {
          namedImport: true,
        },
      },
    },
    textarea: {
      elementType: 'TextInput',
      dependency: {
        type: 'library',
        path: 'react-native',
        version: '^0.64.1',
        meta: {
          namedImport: true,
        },
      },
      attrs: {
        multiline: { type: 'static', content: true },
      },
    },
    numberinput: {
      elementType: 'TextInput',
      dependency: {
        type: 'library',
        path: 'react-native',
        version: '^0.64.1',
        meta: {
          namedImport: true,
        },
      },
      attrs: {
        keyboardType: { type: 'static', content: 'numeric' },
      },
    },
    radiobutton: {
      elementType: 'null',
      ignore: true,
    },
    checkbox: {
      elementType: 'Switch',
      dependency: {
        type: 'library',
        path: 'react-native',
        version: '^0.64.1',
        meta: {
          namedImport: true,
        },
      },
      attrs: {
        value: { type: 'dynamic', content: { referenceType: 'attr', id: 'checked' } },
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

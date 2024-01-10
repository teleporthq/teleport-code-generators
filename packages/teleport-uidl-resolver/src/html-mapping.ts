import { Mapping } from '@teleporthq/teleport-types'

export const HTMLMapping: Mapping = {
  elements: {
    container: {
      elementType: 'div',
    },
    group: {
      elementType: 'div',
    },
    text: {
      elementType: 'span',
    },
    linebreak: {
      elementType: 'br',
      selfClosing: true,
    },
    image: {
      elementType: 'img',
      attrs: {
        src: { type: 'dynamic', content: { referenceType: 'attr', id: 'url' } },
      },
      selfClosing: true,
    },
    'html-node': {
      elementType: 'dangerous-html',
      dependency: {
        type: 'package',
        path: 'dangerous-html',
        version: '0.1.13',
        meta: {
          importJustPath: true,
        },
      },
    },
    'date-time-node': {
      elementType: 'date-time-primitive',
      dependency: {
        type: 'package',
        version: 'github:teleporthq/date-time-primitive',
        path: '@teleporthq/date-time-primitive',
        meta: { importJustPath: true },
      },
    },
    'lottie-node': {
      elementType: 'lottie-player',
      dependency: {
        type: 'package',
        path: '@lottiefiles/lottie-player',
        version: '1.6.0',
        meta: {
          importJustPath: true,
        },
      },
    },
    textinput: {
      elementType: 'input',
      attrs: {
        type: { type: 'static', content: 'text' },
      },
      selfClosing: true,
    },
    passwordinput: {
      elementType: 'input',
      attrs: {
        type: { type: 'static', content: 'password' },
      },
      selfClosing: true,
    },
    numberinput: {
      elementType: 'input',
      attrs: {
        type: { type: 'static', content: 'number' },
      },
      selfClosing: true,
    },
    checkbox: {
      elementType: 'input',
      attrs: {
        type: { type: 'static', content: 'checkbox' },
      },
      selfClosing: true,
    },
    radiobutton: {
      elementType: 'input',
      attrs: {
        type: { type: 'static', content: 'radio' },
      },
      selfClosing: true,
    },
    textarea: {
      elementType: 'textarea',
    },
    link: {
      elementType: 'a',
      attrs: {
        href: {
          type: 'dynamic',
          content: { referenceType: 'attr', id: 'url' },
        },
      },
    },
    navlink: {
      elementType: 'a',
    },
    button: {
      elementType: 'button',
    },
    form: {
      elementType: 'form',
      attrs: {
        method: { type: 'dynamic', content: { referenceType: 'attr', id: 'type' } },
        action: { type: 'dynamic', content: { referenceType: 'attr', id: 'url' } },
      },
    },
    list: {
      elementType: 'ul',
      children: [
        {
          type: 'repeat',
          content: {
            node: {
              type: 'element',
              content: {
                elementType: 'li',
                name: 'item',
                children: [
                  {
                    type: 'dynamic',
                    content: {
                      referenceType: 'local',
                      id: 'item',
                    },
                  },
                ],
              },
            },
            dataSource: { type: 'dynamic', content: { referenceType: 'attr', id: 'items' } },
            meta: {
              useIndex: true,
            },
          },
        },
      ],
    },
    dropdown: {
      elementType: 'select',
      children: [
        {
          type: 'repeat',
          content: {
            node: {
              type: 'element',
              content: {
                elementType: 'option',
                name: 'option',
                children: [
                  {
                    type: 'dynamic',
                    content: {
                      referenceType: 'local',
                      id: 'item',
                    },
                  },
                ],
              },
            },
            dataSource: { type: 'dynamic', content: { referenceType: 'attr', id: 'options' } },
            meta: {
              useIndex: true,
            },
          },
        },
      ],
    },
    video: {
      elementType: 'video',
    },
    audio: {
      elementType: 'audio',
    },
    picture: {
      elementType: 'picture',
      children: [
        { type: 'dynamic', content: { referenceType: 'children', id: 'children' } },
        { type: 'static', content: 'This browser does not support the image formats given' },
      ],
    },
    source: {
      elementType: 'source',
      attrs: {
        src: { type: 'dynamic', content: { referenceType: 'attr', id: 'url' } },
      },
      selfClosing: true,
    },
    icon: {
      elementType: 'svg',
    },
    separator: {
      elementType: 'hr',
    },
  },
  events: {},
  attributes: {},
  illegalClassNames: ['', 'Component'],
  illegalPropNames: ['', 'this', 'prop', 'props', 'state', 'window', 'document'],
}

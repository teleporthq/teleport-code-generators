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
        // Deferred decoding + off-screen loading as the DEFAULT for every
        // image. A generated page routinely carries dozens (a product grid, a
        // gallery, a long landing page) and eagerly fetching all of them
        // competes with the one image that actually matters for LCP.
        //
        // The exception is the above-the-fold hero, which must load eagerly or
        // this trade goes the wrong way. That is set as an attribute ON THE
        // NODE (see `applyImagePriorityHints` in the GUI mapper), and a UIDL
        // attribute overrides a mapping one — so the hero's `eager` wins here
        // and an author's own `loading` value wins over both.
        loading: { type: 'static', content: 'lazy' },
        decoding: { type: 'static', content: 'async' },
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
    'markdown-node': {
      elementType: 'div',
    },
    'rich-text-editor-node': {
      elementType: 'div',
    },
    // The Collapsible Text primitive decomposes to plain elements; its root is a
    // generic block wrapper. Without this mapping the codegen would emit a literal
    // `<collapsible-text>` custom element, which renders inline (dropping the
    // authored width/box styles) and breaks the `-webkit-line-clamp` overflow
    // measurement the shipped `TqCollapsibleTextOverflow` helper relies on.
    'collapsible-text': {
      elementType: 'div',
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
    'model-viewer-node': {
      elementType: 'model-viewer',
      dependency: {
        type: 'package',
        path: '@google/model-viewer',
        version: '4.3.1',
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
    'prop-link': {
      elementType: 'a',
      attrs: {
        href: {
          type: 'dynamic',
          content: { referenceType: 'attr', id: 'url' },
        },
      },
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
  illegalClassNames: ['', 'Component'],
  illegalPropNames: ['', 'this', 'prop', 'props', 'state', 'window', 'document'],
}

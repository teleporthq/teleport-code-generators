import { Mapping } from '@teleporthq/teleport-types'

export const ReactMapping: Mapping = {
  elements: {
    fragment: {
      elementType: 'Fragment',
      semanticType: 'Fragment',
      dependency: {
        type: 'library',
        path: 'react',
        version: '^17.0.2',
        meta: {
          namedImport: true,
        },
      },
    },
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
        version: '7.7.12',
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
    'date-time-node': {
      elementType: 'DateTimePrimitive',
      dependency: {
        type: 'package',
        path: '@teleporthq/react-components',
        version: 'latest',
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
    // React renders the custom element directly; the side-effect import
    // registers it. The BUNDLED build on purpose: it embeds three, so the
    // standalone React target needs no peer-dependency plumbing (the react
    // project generator has no plugin hook to pin `three` the way the Next
    // generator does).
    'model-viewer-node': {
      elementType: 'model-viewer',
      dependency: {
        type: 'package',
        path: '@google/model-viewer',
        version: '4.3.1',
        meta: {
          importJustPath: true,
          importAlias: '@google/model-viewer/dist/model-viewer.min.js',
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
    allowfullscreen: 'allowFullScreen',
    autocomplete: 'autoComplete',
    autofocus: 'autoFocus',
    autoplay: 'autoPlay',
    crossorigin: 'crossOrigin',
    tabindex: 'tabIndex',
    enctype: 'encType',
    formaction: 'formAction',
    novalidate: 'noValidate',
    hreflang: 'hrefLang',
  },
  illegalClassNames: ['React', 'Fragment', 'ReactDOM', 'PropTypes'],
}

import { Mapping } from '@teleporthq/teleport-types'

export const NextProjectMapping: Mapping = {
  elements: {
    navlink: {
      elementType: 'Link',
      dependency: {
        type: 'library',
        path: 'next/link',
        version: '^12.1.0',
      },
      attrs: {
        href: { type: 'dynamic', content: { referenceType: 'attr', id: 'transitionTo' } },
      },
      children: [
        {
          type: 'element',
          content: {
            elementType: 'a',
            name: 'link',
            children: [{ type: 'dynamic', content: { referenceType: 'children', id: 'children' } }],
          },
        },
      ],
    },
    'prop-link': {
      elementType: 'Link',
      dependency: {
        type: 'library',
        path: 'next/link',
        version: '^12.1.0',
      },
      attrs: {
        href: { type: 'dynamic', content: { referenceType: 'attr', id: 'url' } },
      },
      children: [
        {
          type: 'element',
          content: {
            elementType: 'a',
            name: 'link',
            children: [{ type: 'dynamic', content: { referenceType: 'children', id: 'children' } }],
          },
        },
      ],
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
    'markdown-node': {
      elementType: 'div',
    },
    'rich-text-editor-node': {
      elementType: 'RichTextEditor',
      dependency: {
        type: 'local',
        path: '../components/rich-text-editor',
      },
    },
    'thq-drag-area': {
      elementType: 'TqDragArea',
      dependency: {
        type: 'local',
        path: '../components/tq-drag-drop',
        meta: {
          namedImport: true,
        },
      },
    },
    'thq-draggable': {
      elementType: 'TqDraggable',
      dependency: {
        type: 'local',
        path: '../components/tq-drag-drop',
        meta: {
          namedImport: true,
        },
      },
    },
    'thq-droppable': {
      elementType: 'TqDroppable',
      dependency: {
        type: 'local',
        path: '../components/tq-drag-drop',
        meta: {
          namedImport: true,
        },
      },
    },
    'thq-sortable': {
      elementType: 'TqSortable',
      dependency: {
        type: 'local',
        path: '../components/tq-drag-drop',
        meta: {
          namedImport: true,
        },
      },
    },
    'thq-sortable-item': {
      elementType: 'TqSortableItem',
      dependency: {
        type: 'local',
        path: '../components/tq-drag-drop',
        meta: {
          namedImport: true,
        },
      },
    },
    'kanban-node': {
      elementType: 'TqKanban',
      dependency: {
        type: 'local',
        path: '../components/tq-kanban',
      },
    },
    'qrcode-node': {
      elementType: 'TqQrCode',
      dependency: {
        type: 'local',
        path: '../components/tq-qrcode',
      },
    },
    'barcode-node': {
      elementType: 'TqBarcode',
      dependency: {
        type: 'local',
        path: '../components/tq-barcode',
      },
    },
    'signature-node': {
      elementType: 'TqSignature',
      dependency: {
        type: 'local',
        path: '../components/tq-signature',
      },
    },
    'color-picker-node': {
      elementType: 'TqColorPicker',
      dependency: {
        type: 'local',
        path: '../components/tq-color-picker',
      },
    },
    'emoji-picker-node': {
      elementType: 'TqEmojiPicker',
      dependency: {
        type: 'local',
        path: '../components/tq-emoji-picker',
      },
    },
    'motion-node': {
      elementType: 'TqMotion',
      dependency: {
        type: 'local',
        path: '../components/tq-motion',
      },
    },
    'form-file-input-node': {
      elementType: 'TqFormFileInput',
      dependency: {
        type: 'local',
        path: '../components/tq-form-file-input',
      },
    },
    'categories-megamenu-node': {
      elementType: 'TqCategoriesMegamenu',
      dependency: {
        type: 'local',
        path: '../components/tq-categories-megamenu',
      },
    },
    'categories-filter-node': {
      elementType: 'TqCategoriesFilter',
      dependency: {
        type: 'local',
        path: '../components/tq-categories-filter',
      },
    },
    'countdown-node': {
      elementType: 'TqCountdown',
      dependency: {
        type: 'local',
        path: '../components/tq-countdown',
      },
    },
    'lottie-node': {
      elementType: 'lottie-player',
      dependency: {
        type: 'package',
        version: '1.6.0',
        path: '@lottiefiles/lottie-player',
        meta: {
          importJustPath: true,
          needsWindowObject: true,
        },
      },
    },
    // Same treatment as lottie-player: <model-viewer> is a self-registering
    // web component that touches window at import time, so the side-effect
    // import is emitted inside a window-guarded dynamic import. The version is
    // kept in sync with the editor-canvas CDN build (MODEL_VIEWER_VERSION).
    'model-viewer-node': {
      elementType: 'model-viewer',
      dependency: {
        type: 'package',
        version: '4.3.1',
        path: '@google/model-viewer',
        meta: {
          importJustPath: true,
          needsWindowObject: true,
        },
      },
    },
    'cms-list-repeater': {
      elementType: 'Repeater',
      dependency: {
        type: 'package',
        path: '@teleporthq/react-components',
        version: 'latest',
        meta: {
          namedImport: true,
        },
      },
    },
    'cms-item': {
      elementType: 'DataProvider',
      dependency: {
        type: 'package',
        path: '@teleporthq/react-components',
        version: 'latest',
        meta: {
          namedImport: true,
        },
      },
    },
    'cms-list': {
      elementType: 'DataProvider',
      dependency: {
        type: 'package',
        path: '@teleporthq/react-components',
        version: 'latest',
        meta: {
          namedImport: true,
        },
      },
    },
    'cms-mixed-type': {
      elementType: 'CMSMixedType',
      dependency: {
        type: 'package',
        path: '@teleporthq/react-components',
        version: 'latest',
        meta: {
          namedImport: true,
        },
      },
    },
  },
}

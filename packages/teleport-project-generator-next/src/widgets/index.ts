import { ProjectPlugin } from '@teleporthq/teleport-types'
import { createNextWidgetProjectPlugin } from './project-plugin-factory'
import { generateQrCodeComponentCode } from './qrcode-component'
import { generateBarcodeComponentCode } from './barcode-component'
import { generateSignatureComponentCode } from './signature-component'
import { generateColorPickerComponentCode } from './color-picker-component'
import { generateEmojiPickerComponentCode } from './emoji-picker-component'
import { generateMotionComponentCode } from './motion-component'
import { generateFormFileInputComponentCode } from './form-file-input-component'

const PICKR_CSS_IMPORT = "import '@simonwep/pickr/dist/themes/nano.min.css'"

/**
 * The Next project plugins for the widget primitives. Each emits its local
 * wrapper (+ npm dependency, when the wrapper needs one) only when the
 * generated project uses it.
 */
export const createNextWidgetProjectPlugins = (): ProjectPlugin[] => [
  createNextWidgetProjectPlugin({
    elementType: 'qrcode-node',
    fileName: 'tq-qrcode',
    fileKey: 'tq-qrcode-component',
    generateCode: generateQrCodeComponentCode,
    dependencyName: 'qrcode',
    dependencyVersion: '1.5.4',
  }),
  createNextWidgetProjectPlugin({
    elementType: 'barcode-node',
    fileName: 'tq-barcode',
    fileKey: 'tq-barcode-component',
    generateCode: generateBarcodeComponentCode,
    dependencyName: 'jsbarcode',
    dependencyVersion: '3.12.1',
  }),
  createNextWidgetProjectPlugin({
    elementType: 'signature-node',
    fileName: 'tq-signature',
    fileKey: 'tq-signature-component',
    generateCode: generateSignatureComponentCode,
    dependencyName: 'signature_pad',
    dependencyVersion: '5.0.4',
  }),
  createNextWidgetProjectPlugin({
    elementType: 'color-picker-node',
    fileName: 'tq-color-picker',
    fileKey: 'tq-color-picker-component',
    generateCode: generateColorPickerComponentCode,
    dependencyName: '@simonwep/pickr',
    dependencyVersion: '1.9.1',
    cssImport: PICKR_CSS_IMPORT,
  }),
  createNextWidgetProjectPlugin({
    elementType: 'emoji-picker-node',
    fileName: 'tq-emoji-picker',
    fileKey: 'tq-emoji-picker-component',
    generateCode: generateEmojiPickerComponentCode,
    dependencyName: 'emoji-picker-element',
    dependencyVersion: '1.26.3',
  }),
  createNextWidgetProjectPlugin({
    elementType: 'motion-node',
    fileName: 'tq-motion',
    fileKey: 'tq-motion-component',
    generateCode: generateMotionComponentCode,
    dependencyName: 'framer-motion',
    dependencyVersion: '^11.18.0',
    // framer-motion needs React 18 — bump it like the calendar widget does.
    bumpReact18: true,
  }),
  createNextWidgetProjectPlugin({
    elementType: 'form-file-input-node',
    fileName: 'tq-form-file-input',
    fileKey: 'tq-form-file-input-component',
    generateCode: generateFormFileInputComponentCode,
    // Pure DOM/FileReader wrapper — no npm dependency.
  }),
]

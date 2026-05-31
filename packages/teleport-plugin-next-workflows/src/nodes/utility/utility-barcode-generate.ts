import { NodeHandlerGenerator, handlerToString } from '../types'

async function utility_barcode_generate(config: any, context: Record<string, unknown>) {
  const data = config.data || ''
  const format = config.format || 'code128'
  const scale = config.scale !== undefined ? Number(config.scale) : 3
  const height = config.height !== undefined ? Number(config.height) : 10
  const includeText = config.includeText !== undefined ? config.includeText : true
  const textAlign = config.textAlign || 'center'
  const textSize = config.textSize !== undefined ? Number(config.textSize) : 10
  const foreground = config.foreground || '000000'
  const background = config.background || 'FFFFFF'
  const rotate = config.rotate || 'N'

  if (!data) {
    return { imageUrl: null, imageData: null, error: 'No data provided for barcode generation' }
  }

  const formatMap: Record<string, string> = {
    code128: 'code128',
    CODE128: 'code128',
    code39: 'code39',
    CODE39: 'code39',
    ean13: 'ean13',
    EAN13: 'ean13',
    ean8: 'ean8',
    EAN8: 'ean8',
    upca: 'upca',
    'UPC-A': 'upca',
    upce: 'upce',
    'UPC-E': 'upce',
    itf14: 'itf14',
    ITF14: 'itf14',
    itf: 'interleaved2of5',
    ITF: 'interleaved2of5',
    msi: 'msi',
    MSI: 'msi',
    pharmacode: 'pharmacode',
    codabar: 'rationalizedCodabar',
    datamatrix: 'datamatrix',
    pdf417: 'pdf417',
    azteccode: 'azteccode',
    qrcode: 'qrcode',
  }

  try {
    const __nodeRequire =
      typeof __non_webpack_require__ !== 'undefined' ? __non_webpack_require__ : require
    const bwipjs = __nodeRequire('bwip-js')
    const bcid = formatMap[format] || format.toLowerCase()

    const opts: Record<string, any> = {
      bcid,
      text: String(data),
      scale,
      height,
      rotate,
      backgroundcolor: background,
      barcolor: foreground,
    }

    if (includeText) {
      opts.alttext = String(data)
      opts.textalign = textAlign
      opts.textsize = textSize
    }

    const png = await bwipjs.toBuffer(opts)
    const imageData = 'data:image/png;base64,' + png.toString('base64')

    return { imageUrl: null, imageData }
  } catch (err: unknown) {
    return { imageUrl: null, imageData: null, error: (err as Error).message }
  }
}
export const utilityBarcodeGenerate: NodeHandlerGenerator = {
  nodeType: 'utility-barcode-generate',
  executionEnv: 'server',
  dependencies: {
    'bwip-js': '^4.1.0',
  },
  generateHandler(): string {
    return handlerToString(utility_barcode_generate)
  },
}

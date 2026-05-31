import { NodeHandlerGenerator, handlerToString } from '../types'

async function utility_qr_code_generate(config: any, context: Record<string, unknown>) {
  const data = config.data || ''
  const size = config.size !== undefined ? Number(config.size) : 256
  let errorCorrection = config.errorCorrection || 'M'
  const margin = config.margin !== undefined ? Number(config.margin) : 4
  const darkColor = config.darkColor || '#000000'
  const lightColor = config.lightColor || '#ffffff'
  const outputType = config.outputType || 'dataUrl'

  if (!data) {
    return { imageUrl: null, imageData: null, error: 'No data provided for QR code generation' }
  }

  const validLevels: Record<string, boolean> = { L: true, M: true, Q: true, H: true }
  if (!validLevels[errorCorrection]) {
    errorCorrection = 'M'
  }

  try {
    const __nodeRequire =
      typeof __non_webpack_require__ !== 'undefined' ? __non_webpack_require__ : require
    const QRCode = __nodeRequire('qrcode')

    const opts: Record<string, any> = {
      width: size,
      margin,
      errorCorrectionLevel: errorCorrection,
      color: {
        dark: darkColor,
        light: lightColor,
      },
    }

    if (outputType === 'svg') {
      const svg = await QRCode.toString(data, { ...opts, type: 'svg' })
      return {
        imageUrl: null,
        imageData:
          'data:image/svg+xml;base64,' + (globalThis as any).Buffer.from(svg).toString('base64'),
        svg,
      }
    }

    const imageData = await QRCode.toDataURL(String(data), opts)
    return { imageUrl: null, imageData }
  } catch (err: unknown) {
    return { imageUrl: null, imageData: null, error: (err as Error).message }
  }
}
export const utilityQrCodeGenerate: NodeHandlerGenerator = {
  nodeType: 'utility-qr-code-generate',
  executionEnv: 'server',
  dependencies: {
    qrcode: '^1.5.0',
  },
  generateHandler(): string {
    return handlerToString(utility_qr_code_generate)
  },
}

import { NodeHandlerGenerator, handlerToString } from '../types'

async function transform_image(config: any, context: Record<string, unknown>) {
  const operation = config.operation || 'resize'
  const imageUrl = config.imageUrl || ''
  const imageBase64 = config.imageBase64 || ''
  const width = config.width
  const height = config.height
  const quality = config.quality
  const format = config.format
  const angle = config.angle
  const direction = config.direction || 'vertical'
  const x = config.x
  const y = config.y
  const cropWidth = config.cropWidth
  const cropHeight = config.cropHeight
  const fit = config.fit || 'inside'
  const blurSigma = config.blurSigma
  const tintColor = config.tintColor
  const watermarkUrl = config.watermarkUrl || ''
  const watermarkPosition = config.watermarkPosition || 'southeast'
  const watermarkOpacity =
    config.watermarkOpacity !== undefined ? Number(config.watermarkOpacity) : 0.5

  if (!imageUrl && !imageBase64) {
    return { result: null, error: 'No image provided. Supply imageUrl or imageBase64.' }
  }

  function parseHexToRgb(hex: string) {
    let h = hex.replace('#', '')
    if (h.length === 3) {
      h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2]
    }
    return {
      r: parseInt(h.substring(0, 2), 16) || 0,
      g: parseInt(h.substring(2, 4), 16) || 0,
      b: parseInt(h.substring(4, 6), 16) || 0,
    }
  }

  try {
    const sharp = require('sharp')

    let inputBuffer
    if (imageBase64) {
      let b64 = imageBase64
      if (b64.indexOf(',') !== -1) {
        b64 = b64.split(',')[1]
      }
      inputBuffer = Buffer.from(b64, 'base64')
    } else {
      const response = await fetch(imageUrl)
      if (!response.ok) {
        return { result: null, error: 'Failed to fetch image: HTTP ' + response.status }
      }
      const arrayBuffer = await response.arrayBuffer()
      inputBuffer = Buffer.from(arrayBuffer)
    }

    let pipeline

    switch (operation) {
      case 'resize': {
        const rw = width ? Number(width) : null
        const rh = height ? Number(height) : null
        if (!rw && !rh) {
          return { result: null, error: 'Resize requires at least width or height' }
        }
        pipeline = sharp(inputBuffer).resize(rw, rh, { fit, withoutEnlargement: false })
        if (format) {
          pipeline = pipeline.toFormat(format, { quality: quality ? Number(quality) : 80 })
        }
        break
      }

      case 'rotate': {
        const rotateAngle = angle !== undefined ? Number(angle) : 0
        pipeline = sharp(inputBuffer).rotate(rotateAngle)
        if (format) {
          pipeline = pipeline.toFormat(format, { quality: quality ? Number(quality) : 80 })
        }
        break
      }

      case 'crop': {
        const cx = x !== undefined ? Number(x) : 0
        const cy = y !== undefined ? Number(y) : 0
        const cw = cropWidth ? Number(cropWidth) : 0
        const ch = cropHeight ? Number(cropHeight) : 0
        if (cw <= 0 || ch <= 0) {
          return { result: null, error: 'Crop requires positive cropWidth and cropHeight' }
        }
        pipeline = sharp(inputBuffer).extract({ left: cx, top: cy, width: cw, height: ch })
        if (format) {
          pipeline = pipeline.toFormat(format, { quality: quality ? Number(quality) : 80 })
        }
        break
      }

      case 'flip': {
        if (direction === 'horizontal') {
          pipeline = sharp(inputBuffer).flop()
        } else {
          pipeline = sharp(inputBuffer).flip()
        }
        if (format) {
          pipeline = pipeline.toFormat(format, { quality: quality ? Number(quality) : 80 })
        }
        break
      }

      case 'compress': {
        const meta = await sharp(inputBuffer).metadata()
        const compressFormat = format || meta.format || 'jpeg'
        const compressQuality = quality ? Number(quality) : 80
        pipeline = sharp(inputBuffer).toFormat(compressFormat, { quality: compressQuality })
        break
      }

      case 'convert': {
        const validFormats = ['jpeg', 'jpg', 'png', 'webp', 'avif', 'tiff']
        let targetFormat = format || 'jpeg'
        if (targetFormat === 'jpg') {
          targetFormat = 'jpeg'
        }
        if (validFormats.indexOf(targetFormat) === -1) {
          return {
            result: null,
            error:
              'Unsupported format: ' + targetFormat + '. Use one of: ' + validFormats.join(', '),
          }
        }
        pipeline = sharp(inputBuffer).toFormat(targetFormat, {
          quality: quality ? Number(quality) : 80,
        })
        break
      }

      case 'blur': {
        let sigma = blurSigma !== undefined ? Number(blurSigma) : 5
        if (sigma < 0.3) {
          sigma = 0.3
        }
        if (sigma > 1000) {
          sigma = 1000
        }
        pipeline = sharp(inputBuffer).blur(sigma)
        if (format) {
          pipeline = pipeline.toFormat(format, { quality: quality ? Number(quality) : 80 })
        }
        break
      }

      case 'sharpen': {
        pipeline = sharp(inputBuffer).sharpen()
        if (format) {
          pipeline = pipeline.toFormat(format, { quality: quality ? Number(quality) : 80 })
        }
        break
      }

      case 'grayscale': {
        pipeline = sharp(inputBuffer).grayscale()
        if (format) {
          pipeline = pipeline.toFormat(format, { quality: quality ? Number(quality) : 80 })
        }
        break
      }

      case 'tint': {
        let rgb = { r: 255, g: 0, b: 0 }
        if (typeof tintColor === 'string' && tintColor.charAt(0) === '#') {
          rgb = parseHexToRgb(tintColor)
        } else if (typeof tintColor === 'object' && tintColor !== null) {
          rgb = { r: tintColor.r || 0, g: tintColor.g || 0, b: tintColor.b || 0 }
        }
        pipeline = sharp(inputBuffer).tint(rgb)
        if (format) {
          pipeline = pipeline.toFormat(format, { quality: quality ? Number(quality) : 80 })
        }
        break
      }

      case 'watermark': {
        if (!watermarkUrl) {
          return { result: null, error: 'Watermark requires watermarkUrl' }
        }
        const wmResponse = await fetch(watermarkUrl)
        if (!wmResponse.ok) {
          return { result: null, error: 'Failed to fetch watermark: HTTP ' + wmResponse.status }
        }
        const wmArrayBuffer = await wmResponse.arrayBuffer()
        const wmBuffer = Buffer.from(wmArrayBuffer)

        const mainMeta = await sharp(inputBuffer).metadata()
        const maxWmWidth = Math.round((mainMeta.width || 200) * 0.25)
        const maxWmHeight = Math.round((mainMeta.height || 200) * 0.25)

        let wmResized = await sharp(wmBuffer)
          .resize(maxWmWidth, maxWmHeight, { fit: 'inside' })
          .ensureAlpha()
          .toBuffer()

        if (watermarkOpacity < 1) {
          const wmMeta = await sharp(wmResized).metadata()
          const wmW = wmMeta.width || maxWmWidth
          const wmH = wmMeta.height || maxWmHeight
          const alphaValue = Math.round(watermarkOpacity * 255)
          const alphaBuffer = Buffer.alloc(wmW * wmH, alphaValue)
          const alphaImage = await sharp(alphaBuffer, {
            raw: { width: wmW, height: wmH, channels: 1 },
          })
            .toFormat('png')
            .toBuffer()
          wmResized = await sharp(wmResized)
            .composite([{ input: alphaImage, blend: 'dest-in' }])
            .toBuffer()
        }

        pipeline = sharp(inputBuffer).composite([
          {
            input: wmResized,
            gravity: watermarkPosition,
          },
        ])
        if (format) {
          pipeline = pipeline.toFormat(format, { quality: quality ? Number(quality) : 80 })
        }
        break
      }

      case 'metadata': {
        const imgMeta = await sharp(inputBuffer).metadata()
        return {
          result: {
            width: imgMeta.width,
            height: imgMeta.height,
            format: imgMeta.format,
            channels: imgMeta.channels,
            space: imgMeta.space,
            hasAlpha: imgMeta.hasAlpha,
            density: imgMeta.density,
            size: inputBuffer.length,
          },
        }
      }

      default:
        return { result: null, error: 'Unknown image operation: ' + operation }
    }

    const outputResult = await pipeline.toBuffer({ resolveWithObject: true })
    const outputBuffer = outputResult.data
    const info = outputResult.info
    const outputFormat = info.format || 'png'
    const base64 = 'data:image/' + outputFormat + ';base64,' + outputBuffer.toString('base64')

    return {
      result: base64,
      format: outputFormat,
      width: info.width,
      height: info.height,
      size: info.size,
    }
  } catch (err: unknown) {
    return { result: null, error: (err as Error).message }
  }
}

export const transformImage: NodeHandlerGenerator = {
  nodeType: 'transform-image',
  executionEnv: 'server',
  dependencies: {
    sharp: '^0.33.0',
  },
  generateHandler(): string {
    return handlerToString(transform_image)
  },
}

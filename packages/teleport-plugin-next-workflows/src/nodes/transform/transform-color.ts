import { NodeHandlerGenerator, handlerToString } from '../types'

async function transform_color(config: any, context: Record<string, unknown>) {
  const operation = config.operation || 'convert'
  const color = config.color || '#000000'
  const color2 = config.color2
  const targetFormat = config.targetFormat || config.format || 'hex'
  const amount = config.amount !== undefined ? Number(config.amount) : 10
  const schemeType = config.schemeType || 'complementary'
  let count = config.count !== undefined ? Number(config.count) : 5
  let result: any

  function hexToRgb(hex) {
    let h = hex.replace('#', '')
    if (h.length === 3) {
      h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2]
    }
    return {
      r: parseInt(h.substring(0, 2), 16),
      g: parseInt(h.substring(2, 4), 16),
      b: parseInt(h.substring(4, 6), 16),
    }
  }

  function rgbToHex(r, g, b) {
    const rh = Math.max(0, Math.min(255, Math.round(r))).toString(16)
    const gh = Math.max(0, Math.min(255, Math.round(g))).toString(16)
    const bh = Math.max(0, Math.min(255, Math.round(b))).toString(16)
    return (
      '#' +
      (rh.length === 1 ? '0' + rh : rh) +
      (gh.length === 1 ? '0' + gh : gh) +
      (bh.length === 1 ? '0' + bh : bh)
    )
  }

  function rgbToHsl(r, g, b) {
    r /= 255
    g /= 255
    b /= 255
    const max = Math.max(r, g, b)
    const min = Math.min(r, g, b)
    let h: number
    let s: number
    const l = (max + min) / 2
    if (max === min) {
      h = s = 0
    } else {
      const d = max - min
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
      switch (max) {
        case r:
          h = ((g - b) / d + (g < b ? 6 : 0)) / 6
          break
        case g:
          h = ((b - r) / d + 2) / 6
          break
        case b:
          h = ((r - g) / d + 4) / 6
          break
        default:
          h = 0
      }
    }
    return { h: Math.round(h * 360), s: Math.round(s * 100), l: Math.round(l * 100) }
  }

  function hslToRgb(h, s, l) {
    h /= 360
    s /= 100
    l /= 100
    let r: number
    let g: number
    let b: number
    if (s === 0) {
      r = g = b = l
    } else {
      const hue2rgb = function (hueP: number, hueQ: number, hueT: number) {
        let tt = hueT
        if (tt < 0) {
          tt += 1
        }
        if (tt > 1) {
          tt -= 1
        }
        if (tt < 1 / 6) {
          return hueP + (hueQ - hueP) * 6 * tt
        }
        if (tt < 1 / 2) {
          return hueQ
        }
        if (tt < 2 / 3) {
          return hueP + (hueQ - hueP) * (2 / 3 - tt) * 6
        }
        return hueP
      }
      const q = l < 0.5 ? l * (1 + s) : l + s - l * s
      const p = 2 * l - q
      r = hue2rgb(p, q, h + 1 / 3)
      g = hue2rgb(p, q, h)
      b = hue2rgb(p, q, h - 1 / 3)
    }
    return { r: Math.round(r * 255), g: Math.round(g * 255), b: Math.round(b * 255) }
  }

  function parseColor(c) {
    if (typeof c === 'string' && c.charAt(0) === '#') {
      return hexToRgb(c)
    }
    if (typeof c === 'string' && c.indexOf('rgb') === 0) {
      const nums = c.match(/[0-9]+/g) || []
      return {
        r: parseInt(nums[0], 10) || 0,
        g: parseInt(nums[1], 10) || 0,
        b: parseInt(nums[2], 10) || 0,
      }
    }
    if (typeof c === 'object' && c !== null) {
      return { r: c.r || 0, g: c.g || 0, b: c.b || 0 }
    }
    return { r: 0, g: 0, b: 0 }
  }

  function luminance(r, g, b) {
    let rs = r / 255
    let gs = g / 255
    let bs = b / 255
    rs = rs <= 0.03928 ? rs / 12.92 : Math.pow((rs + 0.055) / 1.055, 2.4)
    gs = gs <= 0.03928 ? gs / 12.92 : Math.pow((gs + 0.055) / 1.055, 2.4)
    bs = bs <= 0.03928 ? bs / 12.92 : Math.pow((bs + 0.055) / 1.055, 2.4)
    return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs
  }

  try {
    const rgb = parseColor(color)
    const hsl = rgbToHsl(rgb.r, rgb.g, rgb.b)

    switch (operation) {
      case 'convert':
        if (targetFormat === 'hex') {
          result = rgbToHex(rgb.r, rgb.g, rgb.b)
        } else if (targetFormat === 'rgb') {
          result = { r: rgb.r, g: rgb.g, b: rgb.b }
        } else if (targetFormat === 'hsl') {
          result = hsl
        } else if (targetFormat === 'rgb-string') {
          result = 'rgb(' + rgb.r + ', ' + rgb.g + ', ' + rgb.b + ')'
        } else if (targetFormat === 'hsl-string') {
          result = 'hsl(' + hsl.h + ', ' + hsl.s + '%, ' + hsl.l + '%)'
        } else {
          result = rgbToHex(rgb.r, rgb.g, rgb.b)
        }
        break
      case 'adjust-brightness':
        const bHsl = { h: hsl.h, s: hsl.s, l: Math.max(0, Math.min(100, hsl.l + amount)) }
        const bRgb = hslToRgb(bHsl.h, bHsl.s, bHsl.l)
        result = rgbToHex(bRgb.r, bRgb.g, bRgb.b)
        break
      case 'adjust-saturation':
        const sHsl = { h: hsl.h, s: Math.max(0, Math.min(100, hsl.s + amount)), l: hsl.l }
        const sRgb = hslToRgb(sHsl.h, sHsl.s, sHsl.l)
        result = rgbToHex(sRgb.r, sRgb.g, sRgb.b)
        break
      case 'adjust-hue':
        const hHsl = { h: (hsl.h + amount + 360) % 360, s: hsl.s, l: hsl.l }
        const hRgb = hslToRgb(hHsl.h, hHsl.s, hHsl.l)
        result = rgbToHex(hRgb.r, hRgb.g, hRgb.b)
        break
      case 'lighten':
        const lHsl = { h: hsl.h, s: hsl.s, l: Math.min(100, hsl.l + amount) }
        const lRgb = hslToRgb(lHsl.h, lHsl.s, lHsl.l)
        result = rgbToHex(lRgb.r, lRgb.g, lRgb.b)
        break
      case 'darken':
        const dHsl = { h: hsl.h, s: hsl.s, l: Math.max(0, hsl.l - amount) }
        const dRgb = hslToRgb(dHsl.h, dHsl.s, dHsl.l)
        result = rgbToHex(dRgb.r, dRgb.g, dRgb.b)
        break
      case 'invert':
        result = rgbToHex(255 - rgb.r, 255 - rgb.g, 255 - rgb.b)
        break
      case 'grayscale':
        const gray = Math.round(0.299 * rgb.r + 0.587 * rgb.g + 0.114 * rgb.b)
        result = rgbToHex(gray, gray, gray)
        break
      case 'generate-scheme':
        const scheme = []
        if (schemeType === 'complementary') {
          scheme.push(rgbToHex(rgb.r, rgb.g, rgb.b))
          const comp = hslToRgb((hsl.h + 180) % 360, hsl.s, hsl.l)
          scheme.push(rgbToHex(comp.r, comp.g, comp.b))
        } else if (schemeType === 'analogous') {
          for (let ai = -1; ai <= 1; ai++) {
            const aRgb = hslToRgb((hsl.h + ai * 30 + 360) % 360, hsl.s, hsl.l)
            scheme.push(rgbToHex(aRgb.r, aRgb.g, aRgb.b))
          }
        } else if (schemeType === 'triadic') {
          for (let ti = 0; ti < 3; ti++) {
            const tRgb = hslToRgb((hsl.h + ti * 120) % 360, hsl.s, hsl.l)
            scheme.push(rgbToHex(tRgb.r, tRgb.g, tRgb.b))
          }
        } else if (schemeType === 'tetradic') {
          for (let qi = 0; qi < 4; qi++) {
            const qRgb = hslToRgb((hsl.h + qi * 90) % 360, hsl.s, hsl.l)
            scheme.push(rgbToHex(qRgb.r, qRgb.g, qRgb.b))
          }
        } else if (schemeType === 'monochromatic') {
          for (let mi = 0; mi < count; mi++) {
            const mL = Math.max(0, Math.min(100, 20 + (60 / (count - 1 || 1)) * mi))
            const mRgb = hslToRgb(hsl.h, hsl.s, mL)
            scheme.push(rgbToHex(mRgb.r, mRgb.g, mRgb.b))
          }
        }
        result = scheme
        break
      case 'mix':
        const rgb2 = parseColor(color2 || '#ffffff')
        const ratio = amount / 100
        const mixR = Math.round(rgb.r * (1 - ratio) + rgb2.r * ratio)
        const mixG = Math.round(rgb.g * (1 - ratio) + rgb2.g * ratio)
        const mixB = Math.round(rgb.b * (1 - ratio) + rgb2.b * ratio)
        result = rgbToHex(mixR, mixG, mixB)
        break
      case 'contrast-ratio':
        const rgb2c = parseColor(color2 || '#ffffff')
        const lum1 = luminance(rgb.r, rgb.g, rgb.b)
        const lum2 = luminance(rgb2c.r, rgb2c.g, rgb2c.b)
        const lighter = Math.max(lum1, lum2)
        const darker = Math.min(lum1, lum2)
        result = Math.round(((lighter + 0.05) / (darker + 0.05)) * 100) / 100
        break
      case 'accessibility-check':
        const rgb2a = parseColor(color2 || '#ffffff')
        const l1 = luminance(rgb.r, rgb.g, rgb.b)
        const l2 = luminance(rgb2a.r, rgb2a.g, rgb2a.b)
        const lt = Math.max(l1, l2)
        const dk = Math.min(l1, l2)
        const contrastRatioVal = Math.round(((lt + 0.05) / (dk + 0.05)) * 100) / 100
        result = {
          contrastRatio: contrastRatioVal,
          aa: { normal: contrastRatioVal >= 4.5, large: contrastRatioVal >= 3 },
          aaa: { normal: contrastRatioVal >= 7, large: contrastRatioVal >= 4.5 },
        }
        break
      case 'random':
        const rr = Math.floor(Math.random() * 256)
        const rg = Math.floor(Math.random() * 256)
        const rb = Math.floor(Math.random() * 256)
        result = rgbToHex(rr, rg, rb)
        break
      case 'extract-from-image': {
        const imageUrl = color
        const imageBase64 = config.imageBase64 || ''
        count = Math.max(1, Math.min(count, 20))

        if (!imageUrl && !imageBase64) {
          return { result: null, error: 'No image provided for color extraction' }
        }

        const sharp = require('sharp')

        let inputBuffer
        if (imageBase64) {
          let b64Data = imageBase64
          if (b64Data.indexOf(',') !== -1) {
            b64Data = b64Data.split(',')[1]
          }
          inputBuffer = Buffer.from(b64Data, 'base64')
        } else {
          const imgResponse = await fetch(imageUrl)
          if (!imgResponse.ok) {
            return { result: null, error: 'Failed to fetch image: HTTP ' + imgResponse.status }
          }
          const imgArrayBuffer = await imgResponse.arrayBuffer()
          inputBuffer = Buffer.from(imgArrayBuffer)
        }

        const pixelResult = await sharp(inputBuffer)
          .resize(100, 100, { fit: 'inside' })
          .removeAlpha()
          .raw()
          .toBuffer({ resolveWithObject: true })

        const pixelData = pixelResult.data
        const pixelInfo = pixelResult.info
        const totalPixels = pixelInfo.width * pixelInfo.height

        const bucketSize = 64
        const buckets: Record<
          string,
          { count: number; totalR: number; totalG: number; totalB: number }
        > = {}

        for (let pi = 0; pi < totalPixels; pi++) {
          const offset = pi * 3
          const pr = pixelData[offset]
          const pg = pixelData[offset + 1]
          const pb = pixelData[offset + 2]

          const br = Math.floor(pr / bucketSize)
          const bg = Math.floor(pg / bucketSize)
          const bb = Math.floor(pb / bucketSize)
          const bKey = br + ',' + bg + ',' + bb

          if (!buckets[bKey]) {
            buckets[bKey] = { count: 0, totalR: 0, totalG: 0, totalB: 0 }
          }
          buckets[bKey].count++
          buckets[bKey].totalR += pr
          buckets[bKey].totalG += pg
          buckets[bKey].totalB += pb
        }

        const sorted = Object.values(buckets).sort(function (a, b) {
          return b.count - a.count
        })

        const palette: Array<{
          hex: string
          rgb: { r: number; g: number; b: number }
          percentage: number
        }> = []
        for (let bi = 0; bi < Math.min(count, sorted.length); bi++) {
          const bucket = sorted[bi]
          const avgR = Math.round(bucket.totalR / bucket.count)
          const avgG = Math.round(bucket.totalG / bucket.count)
          const avgB = Math.round(bucket.totalB / bucket.count)
          palette.push({
            hex: rgbToHex(avgR, avgG, avgB),
            rgb: { r: avgR, g: avgG, b: avgB },
            percentage: Math.round((bucket.count / totalPixels) * 10000) / 100,
          })
        }

        result = {
          dominant: palette.length > 0 ? palette[0].hex : null,
          palette,
          count: palette.length,
        }
        break
      }
      default:
        return { result: null, error: 'Unknown operation: ' + operation }
    }

    return { result }
  } catch (err: unknown) {
    return { result: null, error: (err as Error).message }
  }
}
export const transformColor: NodeHandlerGenerator = {
  nodeType: 'transform-color',
  executionEnv: 'universal',
  dependencies: {
    sharp: '^0.33.0',
  },
  generateHandler(): string {
    return handlerToString(transform_color)
  },
}

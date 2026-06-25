/**
 * Generates the TqQrCode wrapper. `qrcode` is dependency-free and SSR-safe to
 * import (it only touches the DOM inside the effect), so no `next/dynamic` is
 * needed. Mirrors the editor renderer node so the canvas preview matches output.
 */
export const generateQrCodeComponentCode = (): string => {
  return `import React, { useEffect, useRef } from 'react'
import QRCode from 'qrcode'

const TqQrCode = ({
  value = '',
  size = 200,
  level = 'M',
  foreground = '#000000',
  background = '#ffffff',
  margin = 4,
  renderType = 'canvas',
  logoUrl = '',
  logoSize = 40,
  ...rest
}) => {
  const canvasRef = useRef(null)
  const svgRef = useRef(null)

  useEffect(() => {
    const text = String(value == null ? '' : value) || ' '
    const options = {
      errorCorrectionLevel: level,
      margin: Number(margin) || 0,
      width: Number(size) || 200,
      color: { dark: foreground, light: background === 'transparent' ? '#00000000' : background },
    }

    if (renderType === 'svg' && svgRef.current) {
      QRCode.toString(text, { ...options, type: 'svg' }, (error, svg) => {
        if (!error && svgRef.current) {
          svgRef.current.innerHTML = svg
        }
      })
      return
    }

    if (canvasRef.current) {
      QRCode.toCanvas(canvasRef.current, text, options, (error) => {
        if (error || !canvasRef.current) {
          return
        }
        const context = canvasRef.current.getContext('2d')
        const drawnLogoSize = Number(logoSize) || 0
        if (logoUrl && context && drawnLogoSize > 0) {
          const image = new Image()
          image.crossOrigin = 'anonymous'
          image.onload = () => {
            if (!canvasRef.current) {
              return
            }
            const x = (canvasRef.current.width - drawnLogoSize) / 2
            const y = (canvasRef.current.height - drawnLogoSize) / 2
            context.fillStyle = '#ffffff'
            context.fillRect(x - 2, y - 2, drawnLogoSize + 4, drawnLogoSize + 4)
            context.drawImage(image, x, y, drawnLogoSize, drawnLogoSize)
          }
          image.src = logoUrl
        }
      })
    }
  }, [value, size, level, foreground, background, margin, renderType, logoUrl, logoSize])

  return (
    <div {...rest}>
      {renderType === 'svg' ? (
        <div ref={svgRef} style={{ maxWidth: '100%' }} />
      ) : (
        <canvas ref={canvasRef} style={{ maxWidth: '100%', height: 'auto' }} />
      )}
    </div>
  )
}

export default TqQrCode
`
}

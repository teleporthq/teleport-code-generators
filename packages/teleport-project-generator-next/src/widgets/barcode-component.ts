/**
 * Generates the TqBarcode wrapper. `jsbarcode` is dependency-free and renders
 * into an <svg> ref; it THROWS on a value that is invalid for the chosen format
 * (e.g. letters in an EAN), so the call is guarded to never crash the page.
 */
export const generateBarcodeComponentCode = (): string => {
  return `import React, { useEffect, useRef } from 'react'
import JsBarcode from 'jsbarcode'

const TqBarcode = ({
  value = '',
  format = 'CODE128',
  lineColor = '#000000',
  background = '#ffffff',
  barWidth = 2,
  height = 100,
  displayValue = true,
  fontSize = 20,
  textMargin = 2,
  ...rest
}) => {
  const svgRef = useRef(null)

  useEffect(() => {
    if (!svgRef.current) {
      return
    }
    try {
      JsBarcode(svgRef.current, String(value == null ? '' : value) || '0', {
        format,
        lineColor,
        background: background === 'transparent' ? '#00000000' : background,
        width: Number(barWidth) || 1,
        height: Number(height) || 100,
        displayValue: displayValue === true || displayValue === 'true',
        fontSize: Number(fontSize) || 20,
        textMargin: Number(textMargin) || 0,
      })
    } catch (error) {
      // invalid value for the chosen barcode format — leave the svg empty
    }
  }, [value, format, lineColor, background, barWidth, height, displayValue, fontSize, textMargin])

  return (
    <div {...rest}>
      <svg ref={svgRef} style={{ maxWidth: '100%' }} />
    </div>
  )
}

export default TqBarcode
`
}

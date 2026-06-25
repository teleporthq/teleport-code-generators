/**
 * Generates the TqSignature wrapper. `signature_pad` binds pointer events to a
 * canvas; instantiated inside the effect so it never runs during SSR. The drawn
 * signature is written (as a PNG data-URL) to a paired hidden <input id={id}> and
 * a native `change` is dispatched, so the platform's input-value reader and the
 * `event-input-updated` workflow trigger pick it up — the same machinery as a
 * native form input.
 */
export const generateSignatureComponentCode = (): string => {
  return `import React, { useEffect, useRef } from 'react'
import SignaturePad from 'signature_pad'

const TqSignature = ({
  id,
  value = '',
  penColor = '#000000',
  backgroundColor = '#ffffff',
  minWidth = 0.5,
  maxWidth = 2.5,
  height = 200,
  clearable = true,
  ...rest
}) => {
  const canvasRef = useRef(null)
  const inputRef = useRef(null)
  const padRef = useRef(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) {
      return
    }
    const ratio = Math.max(typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1, 1)
    canvas.width = (canvas.offsetWidth || 300) * ratio
    canvas.height = (Number(height) || 200) * ratio
    const context = canvas.getContext('2d')
    if (context) {
      context.scale(ratio, ratio)
    }

    const pad = new SignaturePad(canvas, {
      penColor,
      backgroundColor: backgroundColor === 'transparent' ? 'rgba(0,0,0,0)' : backgroundColor,
      minWidth: Number(minWidth) || 0.5,
      maxWidth: Number(maxWidth) || 2.5,
    })
    padRef.current = pad

    const handleEnd = () => {
      if (inputRef.current) {
        inputRef.current.value = pad.toDataURL()
        inputRef.current.dispatchEvent(new Event('change', { bubbles: true }))
      }
    }
    pad.addEventListener('endStroke', handleEnd)

    return () => {
      pad.removeEventListener('endStroke', handleEnd)
      pad.off()
    }
  }, [penColor, backgroundColor, minWidth, maxWidth, height])

  const handleClear = () => {
    if (padRef.current) {
      padRef.current.clear()
    }
    if (inputRef.current) {
      inputRef.current.value = ''
      inputRef.current.dispatchEvent(new Event('change', { bubbles: true }))
    }
  }

  return (
    <div {...rest}>
      <canvas
        ref={canvasRef}
        style={{
          width: '100%',
          height: (Number(height) || 200) + 'px',
          border: '1px solid #d1d5db',
          borderRadius: '8px',
          touchAction: 'none',
        }}
      />
      <input ref={inputRef} type="hidden" id={id} defaultValue={value} readOnly />
      {clearable === true || clearable === 'true' ? (
        <button type="button" onClick={handleClear} style={{ marginTop: '8px' }}>
          Clear
        </button>
      ) : null}
    </div>
  )
}

export default TqSignature
`
}

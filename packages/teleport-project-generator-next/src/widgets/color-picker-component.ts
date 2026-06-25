/**
 * Generates the TqColorPicker wrapper around `@simonwep/pickr`. Pickr touches
 * `window`/`document` at module scope, so it is loaded with a dynamic `import()`
 * inside the effect (client-only). The selected color is mirrored to a paired
 * hidden <input id={id}> with a native `change` dispatch, so existing workflows
 * and form submissions read it like a native input. Two-way bound: when the
 * `value` prop (a state binding) changes, the picker is updated.
 */
export const generateColorPickerComponentCode = (): string => {
  return `import React, { useEffect, useRef } from 'react'

const formatColor = (color, format) => {
  if (!color) {
    return ''
  }
  if (format === 'rgb') {
    return color.toRGBA().toString(0)
  }
  if (format === 'hsl') {
    return color.toHSLA().toString(0)
  }
  return color.toHEXA().toString()
}

const TqColorPicker = ({
  id,
  value = '#42b883',
  format = 'hex',
  swatches = [],
  display = 'popup',
  opacity = true,
  ...rest
}) => {
  const elRef = useRef(null)
  const inputRef = useRef(null)
  const pickrRef = useRef(null)

  useEffect(() => {
    let active = true
    import('@simonwep/pickr').then(({ default: Pickr }) => {
      if (!active || !elRef.current) {
        return
      }
      const pickr = Pickr.create({
        el: elRef.current,
        theme: 'nano',
        default: value || '#42b883',
        swatches: Array.isArray(swatches) ? swatches : [],
        inline: display === 'inline',
        components: {
          preview: true,
          opacity: opacity === true || opacity === 'true',
          hue: true,
          interaction: { input: true, save: true },
        },
      })
      pickrRef.current = pickr
      const emit = (color) => {
        if (!inputRef.current) {
          return
        }
        inputRef.current.value = formatColor(color, format)
        inputRef.current.dispatchEvent(new Event('change', { bubbles: true }))
      }
      pickr.on('save', (color) => emit(color))
      pickr.on('change', (color) => emit(color))
    })
    return () => {
      active = false
      if (pickrRef.current) {
        pickrRef.current.destroyAndRemove()
        pickrRef.current = null
      }
    }
  }, [format, display, opacity])

  useEffect(() => {
    if (pickrRef.current && value) {
      pickrRef.current.setColor(value, true)
    }
  }, [value])

  return (
    <div {...rest}>
      <div ref={elRef} />
      <input ref={inputRef} type="hidden" id={id} defaultValue={value} readOnly />
    </div>
  )
}

export default TqColorPicker
`
}

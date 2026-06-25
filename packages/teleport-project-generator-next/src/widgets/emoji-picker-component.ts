/**
 * Generates the TqEmojiPicker wrapper around the `emoji-picker-element` web
 * component. The module registers a custom element at import (SSR-unsafe), so it
 * is loaded with a dynamic `import()` inside the effect and only rendered once
 * ready. The chosen emoji is mirrored to a paired hidden <input id={id}> with a
 * native `change` dispatch so workflows and forms read it like a native input.
 * Its styles live in shadow DOM, so no global stylesheet import is required.
 */
export const generateEmojiPickerComponentCode = (): string => {
  return `import React, { useEffect, useRef, useState } from 'react'

const TqEmojiPicker = ({ id, value = '', theme = 'light', columns = 8, ...rest }) => {
  const pickerRef = useRef(null)
  const inputRef = useRef(null)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    let active = true
    import('emoji-picker-element').then(() => {
      if (active) {
        setReady(true)
      }
    })
    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    const picker = pickerRef.current
    if (!picker) {
      return
    }
    const handleEmojiClick = (event) => {
      const emoji = event.detail && event.detail.unicode ? event.detail.unicode : ''
      if (inputRef.current && emoji) {
        inputRef.current.value = emoji
        inputRef.current.dispatchEvent(new Event('change', { bubbles: true }))
      }
    }
    picker.addEventListener('emoji-click', handleEmojiClick)
    return () => picker.removeEventListener('emoji-click', handleEmojiClick)
  }, [ready])

  return (
    <div {...rest}>
      {ready
        ? React.createElement('emoji-picker', {
            ref: pickerRef,
            class: theme === 'dark' ? 'dark' : theme === 'auto' ? '' : 'light',
            style: { '--num-columns': Number(columns) || 8 },
          })
        : null}
      <input ref={inputRef} type="hidden" id={id} defaultValue={value} readOnly />
    </div>
  )
}

export default TqEmojiPicker
`
}

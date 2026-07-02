/**
 * Generates the TqFormFileInput wrapper — the in-form upload field behind
 * `<tq-form-file-input>`. It is a pure controlled input over a page state
 * whose value is an ARRAY of PickedFile POJOs
 * `{ name, size, type, lastModified, dataURL }` — the exact shape the
 * `browser-pick-files` workflow node emits and `file-storage-upload`
 * consumes (dataURL→Blob). Nothing is uploaded at pick time: the
 * form-submit workflow reads the state via state-get-local-state and
 * uploads there. Commits go through the page-supplied `onChange`
 * (`event.target.value` = JSON) and are mirrored into a paired hidden
 * input (no `name`, so it never leaks into form payloads) that dispatches
 * a native `change` for the platform's element-trigger machinery — the
 * same bridge the signature widget uses.
 */
export const generateFormFileInputComponentCode = (): string => {
  return `import React, { useRef } from 'react'

const readPickedFile = (file) =>
  new Promise((resolve) => {
    const reader = new FileReader()
    reader.onload = () =>
      resolve({
        name: file.name,
        size: file.size,
        type: file.type,
        lastModified: file.lastModified,
        dataURL: String(reader.result || ''),
      })
    reader.onerror = () => resolve(null)
    reader.readAsDataURL(file)
  })

// stateKey (the GUI export's canonical prop) and state (the legacy/editor
// attr name) are destructured ONLY to keep them off the DOM: neither is a
// valid <div> attribute and both would otherwise leak through {...rest}.
const TqFormFileInput = ({
  id,
  stateKey,
  state,
  value = [],
  multiple = false,
  accept = '',
  label = '',
  maxFiles,
  maxFileSizeMb = 5,
  onChange,
  ...rest
}) => {
  const pickerRef = useRef(null)
  const mirrorRef = useRef(null)
  const files = Array.isArray(value) ? value : []
  const isMultiple = multiple === true || multiple === 'true'
  const fileCap = Number(maxFiles) > 0 ? Number(maxFiles) : isMultiple ? 10 : 1
  const sizeCap = (Number(maxFileSizeMb) > 0 ? Number(maxFileSizeMb) : 5) * 1024 * 1024

  const commit = (next) => {
    const serialized = JSON.stringify(next)
    if (mirrorRef.current) {
      mirrorRef.current.value = serialized
      mirrorRef.current.dispatchEvent(new Event('change', { bubbles: true }))
    }
    // React never synthesizes onChange from a hidden input's native change,
    // so the state setter is invoked directly with the same event shape the
    // generated handler reads (event.target.value).
    if (typeof onChange === 'function') {
      onChange({ target: { value: serialized } })
    }
  }

  const handlePick = async (event) => {
    const picked = Array.from(event.target.files || []).filter((file) => file.size <= sizeCap)
    event.target.value = ''
    if (picked.length === 0) {
      return
    }
    const read = (await Promise.all(picked.map(readPickedFile))).filter(Boolean)
    if (read.length === 0) {
      return
    }
    const next = isMultiple ? files.concat(read).slice(0, fileCap) : read.slice(0, 1)
    commit(next)
  }

  const removeAt = (index) => {
    commit(files.filter((_entry, i) => i !== index))
  }

  return (
    <div {...rest} data-thq="form-file-input">
      {label ? <span style={{ display: 'block', marginBottom: '8px' }}>{label}</span> : null}
      <button
        type="button"
        onClick={() => pickerRef.current && pickerRef.current.click()}
        style={{
          display: 'block',
          width: '100%',
          padding: '16px',
          border: '1px dashed #9ca3af',
          borderRadius: '8px',
          background: 'transparent',
          cursor: 'pointer',
        }}
      >
        {isMultiple ? 'Choose files' : 'Choose file'}
      </button>
      <input
        ref={pickerRef}
        type="file"
        accept={accept || undefined}
        multiple={isMultiple}
        onChange={handlePick}
        style={{ display: 'none' }}
      />
      <input ref={mirrorRef} type="hidden" id={id} defaultValue={JSON.stringify(files)} readOnly />
      {files.length > 0 ? (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginTop: '8px' }}>
          {files.map((file, index) => (
            <div key={index} style={{ position: 'relative', width: '96px' }}>
              {file && file.dataURL && String(file.type || '').indexOf('image/') === 0 ? (
                <img
                  src={file.dataURL}
                  alt={file.name || 'Selected file'}
                  style={{
                    width: '96px',
                    height: '96px',
                    objectFit: 'cover',
                    borderRadius: '8px',
                    border: '1px solid #d1d5db',
                  }}
                />
              ) : (
                <div
                  style={{
                    width: '96px',
                    height: '96px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    padding: '4px',
                    borderRadius: '8px',
                    border: '1px solid #d1d5db',
                    fontSize: '11px',
                    overflow: 'hidden',
                    wordBreak: 'break-all',
                  }}
                >
                  {(file && file.name) || 'file'}
                </div>
              )}
              <button
                type="button"
                aria-label="Remove file"
                onClick={() => removeAt(index)}
                style={{
                  position: 'absolute',
                  top: '-6px',
                  right: '-6px',
                  width: '20px',
                  height: '20px',
                  borderRadius: '50%',
                  border: 'none',
                  background: '#111827',
                  color: '#ffffff',
                  lineHeight: '18px',
                  cursor: 'pointer',
                }}
              >
                ×
              </button>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  )
}

export default TqFormFileInput
`
}

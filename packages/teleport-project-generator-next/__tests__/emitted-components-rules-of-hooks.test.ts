/**
 * Every React component the Next project generator emits as a source STRING is
 * invisible to TypeScript, ESLint and eslint-plugin-react-hooks. This suite is
 * the only thing standing between a Rules-of-Hooks mistake in one of those
 * templates and a runtime crash on every published page that uses it.
 *
 * Regression origin: `tq-countdown` computed its `targetDate` with `useMemo`
 * BELOW the `if (!mounted) return …` guard. React counted 7 hooks on the first
 * render and 8 on the second and threw "Rendered more hooks than during the
 * previous render". The countdown lives in the Navigation component, so the
 * whole site fell through to the error boundary — on localhost and on Vercel.
 */

import { findRulesOfHooksViolations } from './_helpers/rules-of-hooks'

import { generateCountdownComponentCode } from '../src/countdown/component-generator'
import { generateKanbanComponentCode } from '../src/kanban/component-generator'
import { generateDragDropComponentCode } from '../src/drag-drop/component-generator'
import { generateRichTextEditorComponentCode } from '../src/rich-text-editor/component-generator'
import { generateMotionComponentCode } from '../src/widgets/motion-component'
import { generateSignatureComponentCode } from '../src/widgets/signature-component'
import { generateCategoriesFilterComponentCode } from '../src/widgets/categories-filter-component'
import { generateCategoriesMegamenuComponentCode } from '../src/widgets/categories-megamenu-component'
import { generateBarcodeComponentCode } from '../src/widgets/barcode-component'
import { generateQrCodeComponentCode } from '../src/widgets/qrcode-component'
import { generateEmojiPickerComponentCode } from '../src/widgets/emoji-picker-component'
import { generateColorPickerComponentCode } from '../src/widgets/color-picker-component'
import { generateFormFileInputComponentCode } from '../src/widgets/form-file-input-component'
import { generateScrollSceneComponentCode } from '../src/widgets/scroll-scene-component'
import { generateScrollVideoComponentCode } from '../src/widgets/scroll-video-component'
import { COLLAPSIBLE_TEXT_OVERFLOW_COMPONENT_SOURCE } from '../src/collapsible-text/collapsible-text-overflow-component'
import { NAV_ACTIVE_LINK_COMPONENT_SOURCE } from '../src/nav-active-link/nav-active-link-component'
import { generateRichContentEmbedsComponentCode } from '../src/rich-content-embeds/embed-activator-component'
import { TRACKER_COMPONENT_SOURCE } from '../src/analytics/tracker-component'

const EMITTED_COMPONENTS: Array<[string, string]> = [
  ['tq-countdown', generateCountdownComponentCode()],
  ['tq-kanban', generateKanbanComponentCode()],
  ['tq-drag-drop', generateDragDropComponentCode()],
  ['rich-text-editor', generateRichTextEditorComponentCode()],
  ['rich-text-editor (with embeds)', generateRichTextEditorComponentCode({ withEmbeds: true })],
  ['rich-content-embeds', generateRichContentEmbedsComponentCode()],
  ['tq-motion', generateMotionComponentCode()],
  ['tq-scroll-scene', generateScrollSceneComponentCode()],
  ['tq-scroll-video', generateScrollVideoComponentCode()],
  ['tq-signature', generateSignatureComponentCode()],
  ['tq-categories-filter', generateCategoriesFilterComponentCode()],
  ['tq-categories-megamenu', generateCategoriesMegamenuComponentCode()],
  ['tq-barcode', generateBarcodeComponentCode()],
  ['tq-qrcode', generateQrCodeComponentCode()],
  ['tq-emoji-picker', generateEmojiPickerComponentCode()],
  ['tq-color-picker', generateColorPickerComponentCode()],
  ['tq-form-file-input', generateFormFileInputComponentCode()],
  ['tq-collapsible-text-overflow', COLLAPSIBLE_TEXT_OVERFLOW_COMPONENT_SOURCE],
  ['nav-active-links', NAV_ACTIVE_LINK_COMPONENT_SOURCE],
  ['analytics-tracker', TRACKER_COMPONENT_SOURCE],
]

describe('emitted React components obey the Rules of Hooks', () => {
  it.each(EMITTED_COMPONENTS)(
    '%s calls no hook conditionally or after an early return',
    (_name, source) => {
      const violations = findRulesOfHooksViolations(source)
      expect(violations).toEqual([])
    }
  )

  it('covers every component source the generator can emit', () => {
    // A new widget added without a row here would ship unguarded.
    expect(EMITTED_COMPONENTS).toHaveLength(18)
  })
})

describe('the Rules-of-Hooks analyser itself', () => {
  it('flags a hook placed after a conditional early return', () => {
    const violations = findRulesOfHooksViolations(`
      import React, { useState, useMemo } from 'react'
      const Broken = ({ value }) => {
        const [mounted, setMounted] = useState(false)
        if (!mounted) {
          return null
        }
        const doubled = useMemo(() => value * 2, [value])
        return <span>{doubled}</span>
      }
      export default Broken
    `)
    expect(violations).toEqual([
      { kind: 'after-early-return', hook: 'useMemo', fn: 'Broken', line: 8 },
    ])
  })

  it('flags a hook called inside a condition', () => {
    const violations = findRulesOfHooksViolations(`
      import React, { useEffect } from 'react'
      const Broken = ({ enabled }) => {
        if (enabled) {
          useEffect(() => {}, [])
        }
        return null
      }
      export default Broken
    `)
    expect(violations).toEqual([{ kind: 'conditional', hook: 'useEffect', fn: 'Broken', line: 5 }])
  })

  it('does not flag an early return INSIDE a hook callback', () => {
    const violations = findRulesOfHooksViolations(`
      import React, { useEffect, useMemo } from 'react'
      const Fine = ({ mode, value }) => {
        useEffect(() => {
          if (mode !== 'numeric') {
            return undefined
          }
          const id = setInterval(() => {}, 1000)
          return () => clearInterval(id)
        }, [mode])
        const doubled = useMemo(() => value * 2, [value])
        return <span>{doubled}</span>
      }
      export default Fine
    `)
    expect(violations).toEqual([])
  })

  it('does not flag hooks in a sibling component declared after one that returns early', () => {
    const violations = findRulesOfHooksViolations(`
      import React, { useState } from 'react'
      const First = () => {
        return null
      }
      const Second = () => {
        const [value] = useState(0)
        return <span>{value}</span>
      }
      export default Second
    `)
    expect(violations).toEqual([])
  })
})

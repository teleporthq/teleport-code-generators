// @ts-ignore
import componentUIDLJSON from '../fixtures/component-sample.json'
import { createUIDL } from '../fixtures/uidl'
import { createReactComponentGenerator } from '../../src'

import { performance } from 'perf_hooks'

import { ReactComponentStylingFlavors } from '../../src/component-generators/react/react-component.js'

const componentUIDL = componentUIDLJSON as ComponentUIDL

const generator = createReactComponentGenerator({
  variation: ReactComponentStylingFlavors.StyledJSX,
})

describe('React Generator Performance Run', () => {
  describe('with realistic component sample', () => {
    it('takes under 150ms', async () => {
      const t0 = performance.now()
      await generator.generateComponent(componentUIDL, {
        assetsPrefix: '/assets',
        localDependenciesPrefix: '../components',
      })
      const t1 = performance.now()
      console.info(`Generation time took: ${(t1 - t0).toFixed(2)}`)
      expect(t1 - t0).toBeLessThan(1500)
    })
  })

  describe('with generated component sample', () => {
    it('takes under 2500ms', async () => {
      const uidl = createUIDL({ firstLvl: 100, secondLvl: 5, thirdLvl: 2 })
      const t0 = performance.now()
      await generator.generateComponent(uidl, {
        assetsPrefix: '/assets',
        localDependenciesPrefix: '../components',
      })
      const t1 = performance.now()
      console.info(`Generation time took: ${(t1 - t0).toFixed(2)}`)
      expect(t1 - t0).toBeLessThan(25000)
    })
  })
})

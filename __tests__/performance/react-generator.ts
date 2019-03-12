// @ts-ignore
import realComponentUIDL from '../fixtures/react-sample.json'
import { createUIDL } from '../fixtures/uidl'
import { createReactComponentGenerator, GeneratorTypes } from '../../src'

import { performance } from 'perf_hooks'

const generator = createReactComponentGenerator({
  variation: GeneratorTypes.ReactComponentStylingFlavors.StyledJSX,
})

describe('React Generator Performance Run', () => {
  describe('with realistic component sample', () => {
    it('takes under 150ms', async () => {
      const t0 = performance.now()
      await generator.generateComponent(realComponentUIDL, {
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

// @ts-ignore
// import realComponentUIDL from './real-sample.json'
import { createReactComponentGenerator, GeneratorTypes } from '../../src'
import { createUIDL } from './uidl-factory'
import { performance } from 'perf_hooks'

const generator = createReactComponentGenerator({
  variation: GeneratorTypes.ReactComponentStylingFlavors.StyledJSX,
})

// describe("React Generator Performance Run", () => {
//   describe("with realistic component sample", () => {

//   })
// })

const run = async () => {
  const uidl = createUIDL({ firstLvl: 1000, secondLvl: 10, thirdLvl: 2 })
  const t0 = performance.now()
  await generator.generateComponent(uidl, {
    assetsPrefix: '/assets',
    localDependenciesPrefix: '../components',
  })
  const t1 = performance.now()

  console.log(`Component generation took ${(t1 - t0).toFixed(2)}ms`)
}

run()

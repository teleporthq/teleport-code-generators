// @ts-ignore
import componentUIDLJSON from '../../../../examples/test-samples/component-sample.json'
// @ts-ignore
import bigUIDL from './big-sample.json'

import { createReactComponentGenerator } from '../../src'

import { performance } from 'perf_hooks'
import { ComponentUIDL, UIDLElement } from '@teleporthq/teleport-types'

const componentUIDL = componentUIDLJSON as ComponentUIDL

const generator = createReactComponentGenerator('StyledJSX')

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

const createUIDL = (params: { firstLvl?: number; secondLvl?: number; thirdLvl?: number } = {}) => {
  const { firstLvl = 100, secondLvl = 10, thirdLvl = 2 } = params
  const fakeUIDL = JSON.parse(JSON.stringify(bigUIDL)) as ComponentUIDL
  for (let index = 0; index < firstLvl; index++) {
    const firstlvlchildren = []
    for (let index2 = 0; index2 < secondLvl; index2++) {
      const secondlvlchildren = []
      for (let index3 = 0; index3 < thirdLvl; index3++) {
        secondlvlchildren.push(
          {
            type: 'element',
            content: {
              elementType: 'image',
              attrs: {
                url: {
                  type: 'static',
                  content: '/playground_assets',
                },
              },
            },
          },
          {
            type: 'element',
            content: {
              elementType: 'Card',
              dependency: {
                type: 'local',
              },
              children: [{ type: 'static', content: 'Test' }],
            },
          },
          {
            type: 'element',
            content: {
              elementType: 'link',
              attrs: {
                url: {
                  type: 'static',
                  content: 'https://random',
                },
              },
              style: {
                color: { type: 'static', content: 'red' },
              },
              children: [{ type: 'static', content: 'click me' }],
            },
          }
        )
      }

      firstlvlchildren.push({
        type: 'element',
        content: {
          elementType: 'container',
          attrs: {
            'data-attr': {
              type: 'static',
              content: 'test',
            },
          },
          children: secondlvlchildren,
          style: {
            fontSize: { type: 'static', content: '15px' },
            margin: { type: 'static', content: '10px' },
          },
        },
      })
    }

    ;(fakeUIDL.node.content as UIDLElement).children.push({
      type: 'element',
      content: {
        elementType: 'text',
        events: {
          onClick: [],
        },
        children: firstlvlchildren,
      },
    })
  }

  return fakeUIDL
}

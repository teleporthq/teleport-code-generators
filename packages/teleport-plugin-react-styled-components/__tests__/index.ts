import { component, elementNode } from '@teleporthq/teleport-uidl-builders'
import { ComponentStructure } from '@teleporthq/teleport-types'
import { createReactStyledComponentsPlugin } from '../src/index'
import { createComponentChunk, createElementWithStyle } from './mocks'

describe('Testing the functionality for StyledComponents', () => {
  const plugin = createReactStyledComponentsPlugin()
  const componentChunk = createComponentChunk()

  it('Should not add styled as dependency', async () => {
    const uidlSample = component('StyledComponents', elementNode('container'))
    const structure: ComponentStructure = {
      uidl: uidlSample,
      options: {},
      chunks: [componentChunk],
      dependencies: {},
    }

    const { dependencies } = await plugin(structure)

    expect(Object.keys(dependencies).length).toBe(0)
  })

  it('Should add styled as dependency', async () => {
    const elementWithStyle = createElementWithStyle()
    const uidlSample = component('StyledComponents', elementWithStyle)
    const structure: ComponentStructure = {
      uidl: uidlSample,
      options: {},
      chunks: [componentChunk],
      dependencies: {},
    }

    const { dependencies } = await plugin(structure)
    const { styled } = dependencies

    expect(Object.keys(dependencies).length).toBeGreaterThan(0)
    expect(styled.type).toBe('package')
    expect(styled.path).toBe('styled-components')
  })

  it('Generator should not break when chunks are missing', async () => {
    const element = elementNode('container', {}, [])
    const elementWithKey = {
      ...element,
      content: {
        ...element.content,
        key: 'container',
      },
    }
    const uidlSample = component('StyledComponents', elementWithKey)

    const structure: ComponentStructure = {
      uidl: uidlSample,
      options: {},
      chunks: [],
      dependencies: {},
    }

    const { dependencies } = await plugin(structure)

    expect(Object.keys(dependencies).length).toBe(0)
  })

  it('Generates the reactnative dependency path and removes unneeded dependencies', async () => {
    const reactNativePlugin = createReactStyledComponentsPlugin({ componentLibrary: 'reactnative' })

    const elementWithStyle = createElementWithStyle()
    const uidlSample = component('StyledComponents', elementWithStyle)
    const structure: ComponentStructure = {
      uidl: uidlSample,
      options: {},
      chunks: [componentChunk],
      dependencies: {
        container: {
          type: 'library',
          path: 'react-native',
          version: '0.0.0',
        },
      },
    }

    const { dependencies } = await reactNativePlugin(structure)

    expect(dependencies.container).toBeUndefined()

    const { styled } = dependencies

    expect(Object.keys(dependencies).length).toBeGreaterThan(0)
    expect(styled.type).toBe('package')
    expect(styled.path).toBe('styled-components/native')
  })
})

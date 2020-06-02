// @ts-ignore
import uidlSampleJSON from '../../../../examples/test-samples/component-sample.json'
// @ts-ignore
import invalidUidlSampleJSON from '../../../../examples/test-samples/component-invalid-sample.json'

import { createVueComponentGenerator } from '../../src'
import {
  ComponentUIDL,
  GeneratedFile,
  UIDLPropDefinition,
  UIDLEventDefinitions,
} from '@teleporthq/teleport-types'
import { component, elementNode, dynamicNode, staticNode } from '@teleporthq/teleport-uidl-builders'

const uidlSample = uidlSampleJSON as ComponentUIDL
const invalidUidlSample = invalidUidlSampleJSON as ComponentUIDL
const JS_FILE = 'js'
const VUE_FILE = 'vue'
const findFileByType = (files: GeneratedFile[], type: string = JS_FILE) =>
  files.find((file) => file.fileType === type)

describe('Vue Component Generator', () => {
  describe('with standard plugins', () => {
    const generator = createVueComponentGenerator()

    it('should return the files containing the code as string', async () => {
      const result = await generator.generateComponent(uidlSample)
      const vueFile = findFileByType(result.files, VUE_FILE)

      expect(vueFile).toBeDefined()
      expect(vueFile.content).toContain('<template>')
      expect(result.dependencies).toBeDefined()
    })
  })

  describe('with Custom Mapping', () => {
    const generator = createVueComponentGenerator()
    generator.addMapping({ elements: { container: { elementType: 'fakediv' } } })

    it('should render <fakediv> tags', async () => {
      const result = await generator.generateComponent(uidlSample)
      const vueFile = findFileByType(result.files, VUE_FILE)

      expect(vueFile).toBeDefined()
      expect(vueFile.content).toContain('<fakediv')
      expect(result.dependencies).toBeDefined()
    })
  })
})

describe('Vue Component Validator', () => {
  const generator = createVueComponentGenerator()

  it('works with valid UIDL sample', async () => {
    const result = await generator.generateComponent(uidlSample)
    const vueFile = findFileByType(result.files, VUE_FILE)

    expect(vueFile).toBeDefined()
    expect(vueFile.content).toContain('<template>')
    expect(result.dependencies).toBeDefined()
  })

  it('Decoders remove the additational fields and use the uidl', async () => {
    const result = await generator.generateComponent(invalidUidlSample)
    const vueFile = findFileByType(result.files, VUE_FILE)

    expect(vueFile).toBeDefined()
    expect(vueFile.content).toContain('<template>')
    expect(result.dependencies).toBeDefined()
  })

  it('works when validation step is skiped', async () => {
    const options = { skipValidation: true }
    const result = await generator.generateComponent(invalidUidlSample, options)
    const vueFile = findFileByType(result.files, VUE_FILE)

    expect(vueFile).toBeDefined()
    expect(vueFile.content).toContain('<template>')
    expect(result.dependencies).toBeDefined()
  })
})

describe('Should add EventEmitter and Emit events when a fun is sent via prop', () => {
  const generator = createVueComponentGenerator()
  const propDefinitions: Record<string, UIDLPropDefinition> = {
    message: {
      type: 'string',
      defaultValue: 'Hello',
    },
    onClose: {
      type: 'func',
      defaultValue: '() => {}',
    },
  }
  const events: UIDLEventDefinitions = {
    click: [
      {
        type: 'propCall',
        calls: 'onClose',
      },
      {
        type: 'stateChange',
        modifies: 'fakeState',
        newState: false,
      },
    ],
  }
  const uidl: ComponentUIDL = component(
    'PropEventComponent',
    elementNode('container', {}, [
      dynamicNode('prop', 'message'),
      elementNode('button', {}, [staticNode('close')], null, null, events),
    ]),
    propDefinitions
  )

  it('Adds EmitEmitter to the import', async () => {
    const result = await generator.generateComponent(uidl)
    const vueFile = findFileByType(result.files, VUE_FILE)

    expect(vueFile.content).toContain(`@click="handleButtonClick"`)
    expect(vueFile.content).toContain(`this.$emit('onClose')`)
  })
})

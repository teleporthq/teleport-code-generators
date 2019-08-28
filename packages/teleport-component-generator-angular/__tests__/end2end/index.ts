// @ts-ignore
import uidlSampleJSON from '../../../../examples/test-samples/component-sample.json'
// @ts-ignore
import invalidUidlSampleJSON from '../../../../examples/test-samples/component-invalid-sample.json'

import { createAngularComponentGenerator } from '../../src'
import {
  ComponentUIDL,
  GeneratedFile,
  UIDLEventDefinitions,
  UIDLPropDefinition,
} from '@teleporthq/teleport-types'
import {
  component,
  elementNode,
  dynamicNode,
  staticNode,
} from '@teleporthq/teleport-shared/dist/cjs/builders/uidl-builders'

const uidlSample = uidlSampleJSON as ComponentUIDL
const invalidUidlSample = invalidUidlSampleJSON as ComponentUIDL
const TS_FILE = 'ts'
const HTML_FILE = 'html'
const findFileByType = (files: GeneratedFile[], type: string = TS_FILE) =>
  files.find((file) => file.fileType === type)

describe('Angular Component Generator', () => {
  describe('with standard plugins', () => {
    const generator = createAngularComponentGenerator()

    it('should return the files containing the code as string', async () => {
      const result = await generator.generateComponent(uidlSample)
      const tsFile = findFileByType(result.files, TS_FILE)

      expect(tsFile).toBeDefined()
      expect(result.files).toBeDefined()
      expect(Array.isArray(result.files)).toBeTruthy()
      expect(result.files.length).toBe(2)
      expect(tsFile.content).toContain(`import { Component, Input } from '@angular/core`)
      expect(result.dependencies).toBeDefined()
    })
  })
})

describe('Angular Component Validator', () => {
  const generator = createAngularComponentGenerator()

  it('works with valid UIDL sample', async () => {
    const result = await generator.generateComponent(uidlSample)
    const tsFile = findFileByType(result.files, TS_FILE)

    expect(tsFile).toBeDefined()
    expect(result.files.length).toBe(2)
    expect(tsFile.content).toContain(`import { Component, Input } from '@angular/core`)
    expect(result.dependencies).toBeDefined()
  })

  it('throws error when invalid UIDL sample is used', async () => {
    const result = generator.generateComponent(invalidUidlSample)
    await expect(result).rejects.toThrow(Error)
  })

  it('works when validation step is skiped', async () => {
    const options = { skipValidation: true }
    const result = await generator.generateComponent(invalidUidlSample, options)
    const tsFile = findFileByType(result.files, TS_FILE)

    expect(tsFile).toBeDefined()
    expect(result.files.length).toBe(2)
    expect(tsFile.content).toContain(`import { Component, Input } from '@angular/core`)
    expect(result.dependencies).toBeDefined()
  })
})

describe('Should add EventEmitter and Emit events when a fun is sent via prop', () => {
  const generator = createAngularComponentGenerator()
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
    const tsFile = findFileByType(result.files, TS_FILE)
    const htmlFile = findFileByType(result.files, HTML_FILE)

    expect(result.files.length).toBe(2)
    expect(tsFile.content).toContain(`Output, EventEmitter`)
    expect(tsFile.content).toContain(`@Output`)
    expect(tsFile.content).toContain(`onClose: EventEmitter<any> = new EventEmitter()`)
    expect(tsFile.content).toContain(`this.onClose.emit()`)
    expect(htmlFile.content).toContain(`(click)="handleButtonClick()"`)
  })
})

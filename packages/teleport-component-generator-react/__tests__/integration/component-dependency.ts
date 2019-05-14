import { createReactComponentGenerator } from '../../src'
import { GeneratedFile } from '@teleporthq/teleport-generator-shared/lib/typings/generators'

import {
  component,
  definition,
  elementNode,
  componentDependency,
} from '@teleporthq/teleport-generator-shared/lib/builders/uidl-builders'

const generator = createReactComponentGenerator()

const JS_FILE = 'js'
const findFileByType = (files: GeneratedFile[], type: string = JS_FILE) =>
  files.find((file) => file.fileType === type)

const dependencySample = (
  name: string,
  type: string,
  path: string,
  version: string,
  option: object
) => {
  return { name, type, path, version, option }
}

const uidl = (dependency) => {
  return component(
    'Component with dependencies',
    elementNode(
      dependency.name,
      {},
      [],
      componentDependency(dependency.type, dependency.path, dependency.version, dependency.option)
    ),
    {},
    { title: definition('boolean', true) }
  )
}

describe('Component with dependency ', () => {
  describe('from package.json', () => {
    it('renders code with imported package', async () => {
      const result = await generator.generateComponent(
        uidl(
          dependencySample('ReactDatepicker', 'package', 'react-datepicker', '', {
            namedImport: false,
          })
        )
      )
      const jsFile = findFileByType(result.files, JS_FILE)

      expect(jsFile).toBeDefined()
      expect(jsFile.content).toContain("import ReactDatepicker from 'react-datepicker'")
    })

    it('renders code with named import ', async () => {
      const result = await generator.generateComponent(
        uidl(
          dependencySample('ReactDatepicker', 'package', 'react-datepicker', '', {
            namedImport: true,
          })
        )
      )
      const jsFile = findFileByType(result.files, JS_FILE)
      expect(jsFile).toBeDefined()
      expect(jsFile.content).toContain("import { ReactDatepicker } from 'react-datepicker'")
    })

    it('fails to render if dependency option is not known', async () => {
      const result = await generator.generateComponent(
        uidl(
          dependencySample('ReactDatepicker', 'package', 'react-datepicker', '', {
            test: true,
          })
        )
      )
      const jsFile = findFileByType(result.files, JS_FILE)
      expect(jsFile).toBeDefined()
      expect(jsFile.content).not.toContain("import { ReactDatepicker } from 'react-datepicker'")
    })

    it('fails to render code if dependency path is not valid', async () => {
      const result = await generator.generateComponent(
        uidl(
          dependencySample('ReactDatepicker', 'test', 'react-datepicker', '', {
            namedImport: true,
          })
        )
      )
      const jsFile = findFileByType(result.files, JS_FILE)
      expect(jsFile).toBeDefined()
      expect(jsFile.content).not.toContain("import { ReactDatepicker } from 'react-datepicker'")
    })

    it('renders code with original name', async () => {
      const result = await generator.generateComponent(
        uidl(
          dependencySample('Router', 'package', 'react-router', '', {
            namedImport: true,
            originalName: 'BrowserRouter',
          })
        )
      )
      const jsFile = findFileByType(result.files, JS_FILE)

      expect(jsFile).toBeDefined()
      expect(jsFile.content).toContain("import { BrowserRouter as Router } from 'react-router'")
    })
  })

  describe('from local', () => {
    it('renders code with imported package', async () => {
      const result = await generator.generateComponent(
        uidl(
          dependencySample('ReactDatepicker', 'local', '../react-datepicker', '', {
            namedImport: false,
          })
        )
      )
      const jsFile = findFileByType(result.files, JS_FILE)

      expect(jsFile).toBeDefined()
      expect(jsFile.content).toContain("import ReactDatepicker from '../react-datepicker'")
    })

    it('renders code with named import ', async () => {
      const result = await generator.generateComponent(
        uidl(
          dependencySample('ReactDatepicker', 'local', '../react-datepicker', '', {
            namedImport: true,
          })
        )
      )
      const jsFile = findFileByType(result.files, JS_FILE)
      expect(jsFile).toBeDefined()
      expect(jsFile.content).toContain("import { ReactDatepicker } from '../react-datepicker'")
    })

    it('renders code with original name', async () => {
      const result = await generator.generateComponent(
        uidl(
          dependencySample('Router', 'local', 'react-router', '', {
            namedImport: true,
            originalName: 'BrowserRouter',
          })
        )
      )
      const jsFile = findFileByType(result.files, JS_FILE)

      expect(jsFile).toBeDefined()
      expect(jsFile.content).toContain("import { BrowserRouter as Router } from 'react-router'")
    })
  })

  describe('from library', () => {
    it('renders code with named import ', async () => {
      const result = await generator.generateComponent(
        uidl(
          dependencySample('write', 'library', 'fs', '', {
            namedImport: true,
          })
        )
      )
      const jsFile = findFileByType(result.files, JS_FILE)
      expect(jsFile).toBeDefined()
      expect(jsFile.content).toContain("import { write } from 'fs'")
    })
  })
})

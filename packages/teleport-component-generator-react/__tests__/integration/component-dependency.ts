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
  })

  describe('from local', () => {
    it('renders code with imported package', async () => {
      const result = await generator.generateComponent(
        uidl(
          dependencySample('ReactDatepicker', 'package', '../react-datepicker', '', {
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
          dependencySample('ReactDatepicker', 'package', '../react-datepicker', '', {
            namedImport: true,
          })
        )
      )
      const jsFile = findFileByType(result.files, JS_FILE)
      expect(jsFile).toBeDefined()
      expect(jsFile.content).toContain("import { ReactDatepicker } from '../react-datepicker'")
    })
  })
})

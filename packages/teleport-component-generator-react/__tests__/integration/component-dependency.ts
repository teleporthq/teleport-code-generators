import { createReactComponentGenerator } from '../../src'
import { GeneratedFile } from '@teleporthq/teleport-types'
import componentJSON from './component-with-smilar-element-name-depependencies.json'

import {
  component,
  definition,
  elementNode,
  componentDependency,
} from '@teleporthq/teleport-uidl-builders'

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

    it('Remaps elementName when to elements have same name but different dependencies', async () => {
      const result = await generator.generateComponent(componentJSON)
      const jsFile = findFileByType(result.files, JS_FILE)

      expect(jsFile).toBeDefined()
      expect(jsFile.content).toContain(
        `import { ThemeProvider, Button, Avatar, tokens, components } from 'react-ui`
      )
      expect(jsFile.content).toContain(`import { Button as AntdButton } from 'antd'`)
      expect(jsFile.content).toContain(`import 'antd/dist/antd.css'`)
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

    it('Throws error if dependency option is not known during validation', async () => {
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
        ),
        {
          skipValidation: true,
        }
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
          dependencySample('Card', 'library', 'react-material', '', {
            namedImport: true,
          })
        )
      )
      const jsFile = findFileByType(result.files, JS_FILE)
      expect(jsFile).toBeDefined()
      expect(jsFile.content).toContain("import { Card } from 'react-material'")
    })
  })
})

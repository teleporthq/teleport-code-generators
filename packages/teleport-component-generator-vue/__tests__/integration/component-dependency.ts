import {
  component,
  definition,
  elementNode,
  componentDependency,
} from '@teleporthq/teleport-uidl-builders'

import { createVueComponentGenerator } from '../../src'

const vueGenerator = createVueComponentGenerator()

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
    'Component With Dependencies',
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
      const result = await vueGenerator.generateComponent(
        uidl(
          dependencySample('ReactDatepicker', 'package', 'react-datepicker', '', {
            namedImport: false,
          })
        )
      )
      const code = result.files[0].content

      expect(code).toContain("import ReactDatepicker from 'react-datepicker'")
    })

    it('renders code with named import ', async () => {
      const result = await vueGenerator.generateComponent(
        uidl(
          dependencySample('ReactDatepicker', 'package', 'react-datepicker', '', {
            namedImport: true,
          })
        )
      )
      const code = result.files[0].content
      expect(code).toContain("import { ReactDatepicker } from 'react-datepicker'")
    })

    it('renders code with original name', async () => {
      const result = await vueGenerator.generateComponent(
        uidl(
          dependencySample('Router', 'package', 'react-router', '', {
            namedImport: true,
            originalName: 'BrowserRouter',
          })
        )
      )
      const code = result.files[0].content
      expect(code).toContain("import { BrowserRouter as Router } from 'react-router'")
    })
  })

  describe('from local', () => {
    it('renders code with imported package', async () => {
      const result = await vueGenerator.generateComponent(
        uidl(
          dependencySample('ReactDatepicker', 'local', '../react-datepicker', '', {
            namedImport: false,
          })
        )
      )
      const code = result.files[0].content

      expect(code).toContain("import ReactDatepicker from '../react-datepicker'")
    })

    it('renders code with named import ', async () => {
      const result = await vueGenerator.generateComponent(
        uidl(
          dependencySample('ReactDatepicker', 'local', '../react-datepicker', '', {
            namedImport: true,
          })
        )
      )
      const code = result.files[0].content
      expect(code).toContain("import { ReactDatepicker } from '../react-datepicker'")
    })

    it('renders code with original name', async () => {
      const result = await vueGenerator.generateComponent(
        uidl(
          dependencySample('Router', 'local', 'react-router', '', {
            namedImport: true,
            originalName: 'BrowserRouter',
          })
        )
      )
      const code = result.files[0].content
      expect(code).toContain("import { BrowserRouter as Router } from 'react-router'")
    })
  })

  describe('from library', () => {
    it('renders code with named import ', async () => {
      const result = await vueGenerator.generateComponent(
        uidl(
          dependencySample('write', 'local', 'fs', '', {
            namedImport: true,
          })
        )
      )
      const code = result.files[0].content
      expect(code).toContain("import { write } from 'fs'")
    })
  })
})

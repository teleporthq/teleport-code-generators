import {
  component,
  definition,
  elementNode,
  componentDependency,
} from '@teleporthq/teleport-generator-shared/lib/builders/uidl-builders'

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
  })

  describe('from local', () => {
    it('renders code with imported package', async () => {
      const result = await vueGenerator.generateComponent(
        uidl(
          dependencySample('ReactDatepicker', 'package', '../react-datepicker', '', {
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
          dependencySample('ReactDatepicker', 'package', '../react-datepicker', '', {
            namedImport: true,
          })
        )
      )
      const code = result.files[0].content
      expect(code).toContain("import { ReactDatepicker } from '../react-datepicker'")
    })
  })
})

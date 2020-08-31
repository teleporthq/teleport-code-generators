import {
  component,
  definition,
  elementNode,
  componentDependency,
} from '@teleporthq/teleport-uidl-builders'
import componentJSON from './component-with-smilar-element-name-depependencies.json'

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
    it('Remaps elementName when to elements have same name but different dependencies', async () => {
      const result = await vueGenerator.generateComponent(componentJSON)
      const vueFile = result.files[0]

      expect(vueFile).toBeDefined()
      expect(vueFile.content).toContain(
        `import { CThemeProvider, CButton, CAvatar } from '@chakra-ui/vue'`
      )
      expect(vueFile.content).toContain(`import { CButton as AntdCButton } from 'antd'`)
      expect(vueFile.content).toContain(`import 'antd/dist/antd.css'`)
      expect(vueFile.content).toContain(`randomName: randomName`)
      expect(vueFile.content).not.toContain(`antdCSS: antdCSS`)
    })

    it('renders code with imported package', async () => {
      const result = await vueGenerator.generateComponent(
        uidl(
          dependencySample('VueDatepicker', 'package', 'vue-datepicker', '', {
            namedImport: false,
          })
        )
      )
      const code = result.files[0].content

      expect(code).toContain("import VueDatepicker from 'vue-datepicker'")
    })

    it('renders code with named import ', async () => {
      const result = await vueGenerator.generateComponent(
        uidl(
          dependencySample('VueDatepicker', 'package', 'vue-datepicker', '', {
            namedImport: true,
          })
        )
      )
      const code = result.files[0].content
      expect(code).toContain("import { VueDatepicker } from 'vue-datepicker'")
    })

    it('renders code with original name', async () => {
      const result = await vueGenerator.generateComponent(
        uidl(
          dependencySample('VuePicker', 'package', 'vue-datepicker', '', {
            namedImport: true,
            originalName: 'VueDatePicker',
          })
        )
      )
      const code = result.files[0].content
      expect(code).toContain("import { VueDatePicker as VuePicker } from 'vue-datepicker'")
    })
  })

  describe('from local', () => {
    it('renders code with imported package', async () => {
      const result = await vueGenerator.generateComponent(
        uidl(
          dependencySample('VueDatepicker', 'local', '../vue-datepicker', '', {
            namedImport: false,
          })
        )
      )
      const code = result.files[0].content

      expect(code).toContain("import VueDatepicker from '../vue-datepicker'")
    })

    it('renders code with named import ', async () => {
      const result = await vueGenerator.generateComponent(
        uidl(
          dependencySample('VueDatepicker', 'local', '../vue-datepicker', '', {
            namedImport: true,
          })
        )
      )
      const code = result.files[0].content
      expect(code).toContain("import { VueDatepicker } from '../vue-datepicker'")
    })

    it('renders code with original name', async () => {
      const result = await vueGenerator.generateComponent(
        uidl(
          dependencySample('VuePicker', 'local', 'vue-datepicker', '', {
            namedImport: true,
            originalName: 'VueDatepicker',
          })
        )
      )
      const code = result.files[0].content
      expect(code).toContain("import { VueDatepicker as VuePicker } from 'vue-datepicker'")
    })
  })

  describe('from library', () => {
    it('renders code with named import ', async () => {
      const result = await vueGenerator.generateComponent(
        uidl(
          dependencySample('Card', 'library', 'material', '', {
            namedImport: true,
          })
        )
      )
      const code = result.files[0].content
      expect(code).toContain("import { Card } from 'material'")
    })
  })
})

import { createComponentGenerator } from '@teleporthq/teleport-component-generator'

import angularComponentPlugin from '@teleporthq/teleport-plugin-angular-base-component'
import prettierHTML from '@teleporthq/teleport-postprocessor-prettier-html'
import { createPlugin as createStylePlugin } from '@teleporthq/teleport-plugin-css'
import { FILE_TYPE } from '@teleporthq/teleport-shared/dist/cjs/constants'
import { createPlugin as createImportPlugin } from '@teleporthq/teleport-plugin-import-statements'
import { createPostProcessor } from '@teleporthq/teleport-postprocessor-prettier-js'

import angularMapping from './angular-mapping.json'
import { Mapping, ComponentGenerator } from '@teleporthq/teleport-types'

const importStatementsPlugin = createImportPlugin({ fileType: FILE_TYPE.TS })
const prettierJS = createPostProcessor({ fileType: FILE_TYPE.TS })
const stylePlugin = createStylePlugin({
  dynamicStyleAttributeKey: () => '[ngStyle]',
})

export const createAngularComponentGenerator = (mapping: Mapping = {}): ComponentGenerator => {
  const generator = createComponentGenerator()

  generator.addMapping(mapping)
  generator.addMapping(angularMapping)

  generator.addPlugin(angularComponentPlugin)
  generator.addPlugin(importStatementsPlugin)
  generator.addPlugin(stylePlugin)

  generator.addPostProcessor(prettierJS)
  generator.addPostProcessor(prettierHTML)

  return generator
}

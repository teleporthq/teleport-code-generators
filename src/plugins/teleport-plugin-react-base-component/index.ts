import * as t from '@babel/types'

import {
  addChildJSXTag,
  generateASTDefinitionForJSXTag,
  createConditionalJSXExpression,
} from '../../shared/utils/ast-jsx-utils'

import { makeDefaultExport } from '../../shared/utils/ast-js-utils'
import {
  addEventHandlerToTag,
  makePureComponent,
  makeRepeatStructureWithMap,
  addAttributeToTag,
  addTextElementToTag,
} from './utils'

import { capitalize } from '../../shared/utils/string-utils'

import { ComponentPlugin, ComponentPluginFactory, StateIdentifier } from '../../shared/types'

import { ContentNode, PropDefinition, ComponentDependency } from '../../uidl-definitions/types'

interface JSXConfig {
  componentChunkName: string
  exportChunkName: string
  importChunkName: string
}

export const createPlugin: ComponentPluginFactory<JSXConfig> = (config) => {
  const {
    componentChunkName = 'react-component',
    exportChunkName = 'export',
    importChunkName = 'import-local',
  } = config || {}

  const reactComponentPlugin: ComponentPlugin = async (structure) => {
    const { uidl, dependencies } = structure

    dependencies.React = {
      type: 'library',
      path: 'react',
      version: '16.8.3',
    }

    let stateIdentifiers: Record<string, StateIdentifier> = {}
    if (uidl.stateDefinitions) {
      dependencies.useState = {
        type: 'library',
        path: 'react',
        version: '16.8.3',
        meta: {
          namedImport: true,
        },
      }

      const stateDefinitions = uidl.stateDefinitions
      stateIdentifiers = Object.keys(stateDefinitions).reduce(
        (acc: Record<string, StateIdentifier>, stateKey: string) => {
          acc[stateKey] = {
            key: stateKey,
            type: stateDefinitions[stateKey].type,
            default: stateDefinitions[stateKey].defaultValue,
            setter: 'set' + capitalize(stateKey),
          }

          return acc
        },
        {}
      )
    }

    // We will keep a flat mapping object from each component identifier (from the UIDL) to its correspoding JSX AST Tag
    // This will help us inject style or classes at a later stage in the pipeline, upon traversing the UIDL
    // The structure will be populated as the AST is being created
    const nodesLookup = {}
    const jsxTagStructure = generateTreeStructure(
      uidl.content,
      uidl.propDefinitions || {},
      stateIdentifiers,
      nodesLookup,
      dependencies
    )

    const pureComponent = makePureComponent(uidl.name, stateIdentifiers, jsxTagStructure)

    structure.chunks.push({
      type: 'js',
      name: componentChunkName,
      meta: {
        nodesLookup,
      },
      content: pureComponent,
      linkAfter: [importChunkName],
    })

    structure.chunks.push({
      type: 'js',
      name: exportChunkName,
      content: makeDefaultExport(uidl.name),
      linkAfter: [componentChunkName],
    })

    return structure
  }

  return reactComponentPlugin
}

export default createPlugin()

const generateTreeStructure = (
  content: ContentNode,
  propDefinitions: Record<string, PropDefinition>,
  stateIdentifiers: Record<string, StateIdentifier>,
  nodesLookup: Record<string, t.JSXElement>,
  dependencies: Record<string, ComponentDependency>
): t.JSXElement => {
  const { type, children, key, attrs, dependency, events, repeat } = content

  const mainTag = generateASTDefinitionForJSXTag(type)

  if (attrs) {
    Object.keys(attrs).forEach((attrKey) => {
      addAttributeToTag(mainTag, attrKey, attrs[attrKey])
    })
  }

  if (dependency) {
    // Make a copy to avoid reference leaking
    dependencies[type] = { ...dependency }
  }

  if (events) {
    Object.keys(events).forEach((eventKey) => {
      addEventHandlerToTag(mainTag, eventKey, events[eventKey], stateIdentifiers, propDefinitions)
    })
  }

  if (repeat) {
    const { content: repeatContent, dataSource, meta } = repeat

    const contentAST = generateTreeStructure(
      repeatContent,
      propDefinitions,
      stateIdentifiers,
      nodesLookup,
      dependencies
    )

    addAttributeToTag(contentAST, 'key', '$item')

    const repeatAST = makeRepeatStructureWithMap(dataSource, contentAST, meta)
    mainTag.children.push(repeatAST)
  }

  if (children) {
    children.forEach((child) => {
      if (!child) {
        return
      }

      if (typeof child === 'string') {
        addTextElementToTag(mainTag, child)
        return
      }

      if (child.type === 'state') {
        const { states = [], name: stateKey } = child
        states.forEach((stateBranch) => {
          const stateContent = stateBranch.content
          const stateIdentifier = stateIdentifiers[stateKey]
          if (!stateIdentifier) {
            return
          }

          if (typeof stateContent === 'string') {
            const jsxExpression = createConditionalJSXExpression(
              stateContent,
              stateBranch.value,
              stateIdentifier
            )
            mainTag.children.push(jsxExpression)
          } else {
            const stateChildSubTree = generateTreeStructure(
              stateContent,
              propDefinitions,
              stateIdentifiers,
              nodesLookup,
              dependencies
            )

            const jsxExpression = createConditionalJSXExpression(
              stateChildSubTree,
              stateBranch.value,
              stateIdentifier
            )
            mainTag.children.push(jsxExpression)
          }
        })

        return
      }

      const childTag = generateTreeStructure(
        child,
        propDefinitions,
        stateIdentifiers,
        nodesLookup,
        dependencies
      )

      addChildJSXTag(mainTag, childTag)
    })
  }

  // UIDL name should be unique
  nodesLookup[key] = mainTag

  return mainTag
}

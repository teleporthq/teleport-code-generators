import * as t from '@babel/types'

import {
  addChildJSXTag,
  addChildJSXText,
  addAttributeToJSXTag,
  generateASTDefinitionForJSXTag,
  addDynamicChild,
  addDynamicPropOnJsxOpeningTag,
  createConditionalJSXExpression,
} from '../../../utils/jsx-ast'

import { makeDefaultExport } from '../../../utils/js-ast'
import { addEventHandlerToTag, makePureComponent, makeRepeatStructureWithMap } from './utils'

import { capitalize } from '../../../utils/helpers'

import { ComponentPlugin, ComponentPluginFactory, StateIdentifier } from '../../../types'

import {
  ContentNode,
  PropDefinition,
  ComponentDependency,
} from '../../../../uidl-definitions/types'

/**
 *
 * @param tag the ref to the AST tag under construction
 * @param key the key of the attribute that should be added on the current AST node
 * @param value the value(string, number, bool) of the attribute that should be added on the current AST node
 */
const addAttributeToTag = (tag: t.JSXElement, key: string, value: any) => {
  if (typeof value !== 'string') {
    addAttributeToJSXTag(tag, { name: key, value })
    return
  }

  if (value.startsWith('$props.')) {
    const dynamicPropValue = value.replace('$props.', '')
    addDynamicPropOnJsxOpeningTag(tag, key, dynamicPropValue, 'props')
  } else if (value.startsWith('$state.')) {
    const dynamicPropValue = value.replace('$state.', '')
    addDynamicPropOnJsxOpeningTag(tag, key, dynamicPropValue)
  } else if (value === '$item' || value === '$index') {
    addDynamicPropOnJsxOpeningTag(tag, key, value.slice(1))
  } else {
    addAttributeToJSXTag(tag, { name: key, value })
  }
}

const addTextElementToTag = (tag: t.JSXElement, text: string) => {
  if (text.startsWith('$props.') && !text.endsWith('$props.')) {
    addDynamicChild(tag, text.replace('$props.', ''), 'props')
  } else if (text.startsWith('$state.') && !text.endsWith('$state.')) {
    addDynamicChild(tag, text.replace('$state.', ''))
  } else if (text === '$item' || text === '$index') {
    addDynamicChild(tag, text.slice(1))
  } else {
    addChildJSXText(tag, text)
  }
}

export const generateTreeStructure = (
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
        const { states = [], key: stateKey } = child
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

interface JSXConfig {
  componentChunkName: string
  exportChunkName: string
  importChunkName: string
}

export const createPlugin: ComponentPluginFactory<JSXConfig> = (config) => {
  const {
    componentChunkName = 'react-component',
    exportChunkName = 'export',
    importChunkName = 'import',
  } = config || {}

  const reactComponentPlugin: ComponentPlugin = async (structure) => {
    const { uidl, dependencies } = structure

    dependencies.React = {
      type: 'library',
      path: 'react',
    }

    let stateIdentifiers: Record<string, StateIdentifier> = {}
    if (uidl.stateDefinitions) {
      dependencies.useState = {
        type: 'library',
        path: 'react',
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
      linker: {
        after: [importChunkName],
      },
      meta: {
        nodesLookup,
      },
      content: pureComponent,
    })

    structure.chunks.push({
      type: 'js',
      name: exportChunkName,
      linker: {
        after: [componentChunkName],
      },
      content: makeDefaultExport(uidl.name),
    })

    return structure
  }

  return reactComponentPlugin
}

export default createPlugin()

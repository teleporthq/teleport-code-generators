import preset from 'jss-preset-default'
import jss from 'jss'
jss.setup(preset())

import * as t from '@babel/types'

import { ComponentPlugin, ComponentPluginFactory } from '../../shared/types'

import { addClassStringOnJSXTag, generateStyledJSXTag } from '../../shared/utils/jsx-ast'

import { cammelCaseToDashCase } from '../../shared/utils/helpers'
import { ContentNode, StyleDefinitions } from '../../uidl-definitions/types'

interface StyledJSXConfig {
  componentChunkName: string
}

export const createPlugin: ComponentPluginFactory<StyledJSXConfig> = (config) => {
  const { componentChunkName = 'react-component' } = config || {}

  const reactStyledJSXChunkPlugin: ComponentPlugin = async (structure) => {
    const { uidl, chunks } = structure

    const { content } = uidl

    const componentChunk = chunks.find((chunk) => chunk.name === componentChunkName)
    if (!componentChunk) {
      return structure
    }

    const jsxNodesLookup = componentChunk.meta.nodesLookup

    const styleJSXString = generateStyledJSXString(content, jsxNodesLookup)

    if (!styleJSXString || !styleJSXString.length) {
      return structure
    }

    const jsxASTNodeReference = generateStyledJSXTag(styleJSXString.join('\n'))
    const rootJSXNode = jsxNodesLookup[content.key]

    // We have the ability to insert the tag into the existig JSX structure, or do something else with it.
    // Here we take the JSX <style> tag and we insert it as the last child of the JSX structure
    // inside the React Component
    rootJSXNode.children.push(jsxASTNodeReference)

    return structure
  }

  return reactStyledJSXChunkPlugin
}

export default createPlugin()

const prepareDynamicProps = (styles: StyleDefinitions) => {
  return Object.keys(styles).reduce((acc: any, key) => {
    const value = styles[key]
    // tslint:disable-next-line:prefer-conditional-expression
    if (typeof value === 'string' && value.startsWith('$props.')) {
      acc[key] = `\$\{${value.replace('$props.', 'props.')}\}`
    } else {
      acc[key] = styles[key]
    }
    return acc
  }, {})
}

const generateStyledJSXString = (
  content: ContentNode,
  nodesLookup: Record<string, t.JSXElement>
) => {
  let accumulator: any[] = []

  const { styles, children, key, repeat } = content
  if (styles) {
    const root = nodesLookup[key]
    const className = cammelCaseToDashCase(key)
    accumulator.push(
      jss
        .createStyleSheet(
          {
            [`.${className}`]: prepareDynamicProps(styles),
          },
          {
            generateClassName: () => className,
          }
        )
        .toString()
    )
    addClassStringOnJSXTag(root, className)
  }

  if (repeat) {
    accumulator = accumulator.concat(generateStyledJSXString(repeat.content, nodesLookup))
  }

  if (children) {
    children.forEach((child) => {
      // Skip text children
      if (typeof child === 'string') {
        return
      }

      if (child.type === 'state') {
        const { states = [] } = child
        states.forEach((stateBranch) => {
          const stateContent = stateBranch.content
          if (typeof stateContent === 'string') {
            return
          }

          accumulator = accumulator.concat(generateStyledJSXString(stateContent, nodesLookup))
        })

        return
      }

      const items = generateStyledJSXString(child, nodesLookup)
      accumulator = accumulator.concat(...items)
    })
  }

  return accumulator
}

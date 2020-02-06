import * as types from '@babel/types'
import {
  convertValueToLiteral,
  objectToObjectExpression,
  addAttributeToJSXTag,
  addChildJSXTag,
} from '../utils/ast-utils'
import {
  ImportIdentifier,
  UIDLEventHandlerStatement,
  EntryFileOptions,
  UIDLGlobalAsset,
} from '@teleporthq/teleport-types'
import { UIDLUtils } from '@teleporthq/teleport-shared'

// tslint:disable-next-line no-any
export const createConstAssignment = (constName: string, asignment: any = null, t = types) => {
  const declarator = t.variableDeclarator(t.identifier(constName), asignment)
  const constAssignment = t.variableDeclaration('const', [declarator])
  return constAssignment
}

export const createDefaultExport = (exportReference: string, t = types) => {
  return t.exportDefaultDeclaration(t.identifier(exportReference))
}

export const createReactJSSDefaultExport = (
  componentName: string,
  stylesName: string,
  t = types
) => {
  return t.exportDefaultDeclaration(
    t.callExpression(t.callExpression(t.identifier('injectSheet'), [t.identifier(stylesName)]), [
      t.identifier(componentName),
    ])
  )
}

/**
 * You can pass the path of the package which is added at the top of the file and
 * an array of imports that we extract from that package.
 */
export const createGenericImportStatement = (
  path: string,
  imports: ImportIdentifier[],
  t = types
) => {
  // Only one of the imports can be the default one so this is a fail safe for invalid UIDL data
  const defaultImport = imports.find((imp) => !imp.namedImport) // only one import can be default
  const importJustPath = imports.some((imp) => imp.importJustPath)
  // tslint:disable-next-line no-any
  let importASTs: any[] = []
  if (importJustPath) {
    // Just the import path will be present, eg: import './styles.css'
    importASTs = []
  } else if (defaultImport) {
    const namedImports = imports.filter(
      (imp) => imp.identifierName !== defaultImport.identifierName
    )
    // Default import needs to be the first in the array
    importASTs = [
      t.importDefaultSpecifier(t.identifier(defaultImport.identifierName)),
      ...namedImports.map((imp) =>
        t.importSpecifier(
          t.identifier(imp.identifierName),
          t.identifier(imp.originalName || imp.identifierName)
        )
      ),
    ]
  } else {
    // No default import, so array order doesn't matter
    importASTs = imports.map((imp) =>
      t.importSpecifier(
        t.identifier(imp.identifierName),
        t.identifier(imp.originalName || imp.identifierName)
      )
    )
  }
  return t.importDeclaration(importASTs, t.stringLiteral(path))
}

type JSXChild =
  | types.JSXText
  | types.JSXExpressionContainer
  | types.JSXSpreadChild
  | types.JSXElement
  | types.JSXFragment

export const createJSXTag = (
  tagName: string,
  children: JSXChild[] = [],
  selfClosing = false,
  t = types
) => {
  const jsxIdentifier = t.jsxIdentifier(tagName)
  const openingTag = t.jsxOpeningElement(jsxIdentifier, [], selfClosing)
  const closingTag = t.jsxClosingElement(jsxIdentifier)

  const tag = t.jsxElement(openingTag, closingTag, children, selfClosing)

  return tag
}

export const createSelfClosingJSXTag = (tagName: string) => {
  return createJSXTag(tagName, [], true)
}

export const createJSXExpresionContainer = (expression: types.Expression, t = types) => {
  return t.jsxExpressionContainer(expression)
}

// tslint:disable-next-line no-any
export const createFunctionCall = (functionName: string, args: any[] = [], t = types) => {
  const convertedArgs = args.map((value) => {
    // skip objects which are already in AST format
    if (objectIsASTType(value)) {
      return value
    }

    return convertValueToLiteral(value)
  })
  return t.callExpression(t.identifier(functionName), convertedArgs)
}

// tslint:disable-next-line no-any
const objectIsASTType = (obj: any) => {
  if (typeof obj !== 'object') {
    return false
  }

  // TODO: extensive list
  return obj.type === 'JSXElement' || obj.type === 'CallExpression' || obj.type === 'Identifier'
}

// equivalent to (props) => props.title
export const createArrowFunctionWithMemberExpression = (
  argument: string,
  returnIdentifier: string,
  t = types
) => {
  return t.arrowFunctionExpression(
    [t.identifier(argument)],
    t.memberExpression(t.identifier(argument), t.identifier(returnIdentifier))
  )
}

export const createFunctionalComponent = (
  componentName: string,
  jsxRoot: types.JSXElement,
  t = types
) => {
  const returnStatement = t.returnStatement(jsxRoot)
  const arrowFunction = t.arrowFunctionExpression([], t.blockStatement([returnStatement] || []))

  const declarator = t.variableDeclarator(t.identifier(componentName), arrowFunction)
  const component = t.variableDeclaration('const', [declarator])

  return component
}

export const createComponentDecorator = (params: Record<string, unknown>, t = types) => {
  return t.decorator(
    t.callExpression(t.identifier('Component'), [objectToObjectExpression(params)])
  )
}

export const createStateChangeStatement = (statement: UIDLEventHandlerStatement, t = types) => {
  const { modifies, newState } = statement

  const rightOperand =
    newState === '$toggle'
      ? t.unaryExpression('!', t.memberExpression(t.identifier('this'), t.identifier(modifies)))
      : convertValueToLiteral(newState)

  return t.expressionStatement(
    t.assignmentExpression(
      '=',
      t.memberExpression(t.identifier('this'), t.identifier(modifies)),
      rightOperand
    )
  )
}

export const appendAssetsAST = (
  assets: UIDLGlobalAsset[],
  options: EntryFileOptions,
  headNode: types.JSXElement,
  bodyNode: types.JSXElement
) => {
  assets.forEach((asset) => {
    const assetPath = UIDLUtils.prefixAssetsPath(options.assetsPrefix, asset.path)

    // link canonical for SEO
    if (asset.type === 'canonical' && assetPath) {
      const linkTag = createJSXTag('link')
      addAttributeToJSXTag(linkTag, 'rel', 'canonical')
      addAttributeToJSXTag(linkTag, 'href', assetPath)
      addChildJSXTag(headNode, linkTag)
    }

    // link stylesheet (external css, font)
    if ((asset.type === 'style' || asset.type === 'font') && assetPath) {
      const linkTag = createJSXTag('link')
      addAttributeToJSXTag(linkTag, 'rel', 'stylesheet')
      addAttributeToJSXTag(linkTag, 'href', assetPath)
      addChildJSXTag(headNode, linkTag)
    }

    // inline style
    if (asset.type === 'style' && asset.content) {
      const styleTag = createJSXTag('style')
      addAttributeToJSXTag(styleTag, 'dangerouslySetInnerHTML', { __html: asset.content })
      addChildJSXTag(headNode, styleTag)
    }

    // script (external or inline)
    if (asset.type === 'script') {
      const scriptTag = createJSXTag('script')
      addAttributeToJSXTag(scriptTag, 'type', 'text/javascript')
      if (assetPath) {
        addAttributeToJSXTag(scriptTag, 'src', assetPath)
        if (asset.options && asset.options.defer) {
          addAttributeToJSXTag(scriptTag, 'defer', true)
        }
        if (asset.options && asset.options.async) {
          addAttributeToJSXTag(scriptTag, 'async', true)
        }
      } else if (asset.content) {
        addAttributeToJSXTag(scriptTag, 'dangerouslySetInnerHTML', {
          __html: asset.content,
        })
      }

      if (asset.options && asset.options.target === 'body') {
        addChildJSXTag(bodyNode, scriptTag)
      } else {
        addChildJSXTag(headNode, scriptTag)
      }
    }

    // icon
    if (asset.type === 'icon' && assetPath) {
      const iconTag = createJSXTag('link')
      addAttributeToJSXTag(iconTag, 'rel', 'shortcut icon')
      addAttributeToJSXTag(iconTag, 'href', assetPath)

      if (asset.options && asset.options.iconType) {
        addAttributeToJSXTag(iconTag, 'type', asset.options.iconType)
      }
      if (asset.options && asset.options.iconSizes) {
        addAttributeToJSXTag(iconTag, 'sizes', asset.options.iconSizes)
      }

      addChildJSXTag(headNode, iconTag)
    }
  })
}

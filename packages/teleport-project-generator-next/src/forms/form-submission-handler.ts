import {
  ComponentPlugin,
  ComponentPluginFactory,
  UIDLForms,
  UIDLFormDefinition,
  UIDLFormBehavior,
  UIDLElement,
} from '@teleporthq/teleport-types'
import * as types from '@babel/types'
import { UIDLUtils, GenericUtils } from '@teleporthq/teleport-shared'

const sanitizeFormId = (formId: string): string => {
  return formId.replace(/-/g, '_')
}

/**
 * This plugin handles form submissions for Next.js projects.
 * It looks for form elements with a 'data-form-id' attribute and adds:
 * 1. State management for form submission (loading, success, error)
 * 2. Form submission handler that posts to FORMS_API_URL
 * 3. Collects all form field values and sends them in the request
 * 4. Handles success/error behaviors based on form configuration
 */
export const createNextFormSubmissionPlugin: ComponentPluginFactory<{}> = () => {
  const nextFormSubmissionHandler: ComponentPlugin = async (structure) => {
    const { chunks, uidl, options } = structure

    // Get forms from options
    const forms = options.forms

    // Skip if no forms are defined in the project
    if (!forms || !forms.items) {
      return structure
    }

    const jsxComponent = chunks.find(
      (chunk) =>
        chunk.name === 'jsx-component' &&
        typeof chunk.content === 'object' &&
        'type' in chunk.content &&
        chunk.content.type === 'VariableDeclaration'
    )

    if (!jsxComponent) {
      return structure
    }

    // Find all form elements with data-form-id attribute
    const formsInComponent: Array<{
      formId: string
      formElement: UIDLElement
    }> = []

    UIDLUtils.traverseElements(uidl.node, (element) => {
      if (element.elementType === 'form' && element.attrs?.['data-form-id']) {
        const formIdAttr = element.attrs['data-form-id']
        if (formIdAttr.type === 'static' && typeof formIdAttr.content === 'string') {
          formsInComponent.push({
            formId: formIdAttr.content,
            formElement: element,
          })
        }
      }
    })

    // If no forms found, return unchanged
    if (formsInComponent.length === 0) {
      return structure
    }

    const componentBody = (
      (
        (jsxComponent.content as types.VariableDeclaration)
          .declarations[0] as types.VariableDeclarator
      ).init as types.ArrowFunctionExpression
    ).body as types.BlockStatement

    // Add React import for useState
    if (!structure.dependencies.useState) {
      structure.dependencies.useState = {
        type: 'library',
        path: 'react',
        version: '^17.0.2',
        meta: {
          namedImport: true,
        },
      }
    }

    // Process each form found in the component
    for (const { formId } of formsInComponent) {
      const formDefinition = forms.items[formId]

      if (!formDefinition) {
        console.warn(`Form definition not found for form-id: ${formId}`)
        continue
      }

      // Sanitize form ID for use in JavaScript identifiers
      const sanitizedFormId = sanitizeFormId(formId)

      // Check if any behavior uses component-ref for messages
      const successMessage = formDefinition.behaviors?.onSuccess?.details?.message
      const errorMessage = formDefinition.behaviors?.onError?.details?.message
      const limitMessage = formDefinition.behaviors?.onLimit?.details?.message

      // Helper function to calculate the correct relative path to a component
      const calculateComponentPath = (componentId: string): string | null => {
        const projectComponents = options.projectComponents || {}
        const component = projectComponents[componentId]

        if (!component) {
          console.warn(`Component ${componentId} not found in project components`)
          return null
        }

        // Get the strategy from options
        const strategy = options.strategy
        if (!strategy) {
          console.warn('Strategy not found in options, falling back to hardcoded path')
          return `../components/${UIDLUtils.getComponentFileName(component)}`
        }

        // Get the current page's path
        const pagePath = UIDLUtils.getComponentFolderPath(uidl)
        const fromPath = strategy.pages.path.concat(pagePath)

        // Get the component's path
        const componentPath = UIDLUtils.getComponentFolderPath(component)
        const toPath = strategy.components.path.concat(componentPath)

        // Calculate the relative path
        const relativePath = GenericUtils.generateLocalDependenciesPrefix(fromPath, toPath)
        const fileName = UIDLUtils.getComponentFileName(component)

        return `${relativePath}${fileName}`
      }

      // Helper function to get component info from project UIDL
      const getComponentInfo = (componentId: string) => {
        // Get the component from the project UIDL via options
        const projectComponents = options.projectComponents || {}
        const component = projectComponents[componentId]

        if (!component) {
          console.warn(`Component ${componentId} not found in project components`)
          return null
        }

        // Use the outputOptions if available, otherwise compute from component name
        const componentClassName = component.outputOptions?.componentClassName || component.name

        return {
          componentClassName,
        }
      }

      if (successMessage?.type === 'component-ref') {
        const componentId = successMessage.componentId?.content
        if (typeof componentId === 'string') {
          const componentInfo = getComponentInfo(componentId)
          const componentPath = calculateComponentPath(componentId)

          if (
            componentInfo &&
            componentPath &&
            !structure.dependencies[componentInfo.componentClassName]
          ) {
            structure.dependencies[componentInfo.componentClassName] = {
              type: 'local',
              path: componentPath,
            }
          }
        }
      }

      if (errorMessage?.type === 'component-ref') {
        const componentId = errorMessage.componentId?.content
        if (typeof componentId === 'string') {
          const componentInfo = getComponentInfo(componentId)
          const componentPath = calculateComponentPath(componentId)

          if (
            componentInfo &&
            componentPath &&
            !structure.dependencies[componentInfo.componentClassName]
          ) {
            structure.dependencies[componentInfo.componentClassName] = {
              type: 'local',
              path: componentPath,
            }
          }
        }
      }

      if (limitMessage?.type === 'component-ref') {
        const componentId = limitMessage.componentId?.content
        if (typeof componentId === 'string') {
          const componentInfo = getComponentInfo(componentId)
          const componentPath = calculateComponentPath(componentId)

          if (
            componentInfo &&
            componentPath &&
            !structure.dependencies[componentInfo.componentClassName]
          ) {
            structure.dependencies[componentInfo.componentClassName] = {
              type: 'local',
              path: componentPath,
            }
          }
        }
      }

      // Add state for form submission status
      const stateDeclarations = [
        // const [formSubmitting_${sanitizedFormId}, setFormSubmitting_${sanitizedFormId}] = useState(false)
        types.variableDeclaration('const', [
          types.variableDeclarator(
            types.arrayPattern([
              types.identifier(`formSubmitting_${sanitizedFormId}`),
              types.identifier(`setFormSubmitting_${sanitizedFormId}`),
            ]),
            types.callExpression(types.identifier('useState'), [types.booleanLiteral(false)])
          ),
        ]),
        // const [formMessage_${sanitizedFormId}, setFormMessage_${sanitizedFormId}] = useState('')
        types.variableDeclaration('const', [
          types.variableDeclarator(
            types.arrayPattern([
              types.identifier(`formMessage_${sanitizedFormId}`),
              types.identifier(`setFormMessage_${sanitizedFormId}`),
            ]),
            types.callExpression(types.identifier('useState'), [types.stringLiteral('')])
          ),
        ]),
        // const [showFormMessageComponent_${sanitizedFormId}, setShowFormMessageComponent_${sanitizedFormId}] = useState(false)
        types.variableDeclaration('const', [
          types.variableDeclarator(
            types.arrayPattern([
              types.identifier(`showFormMessageComponent_${sanitizedFormId}`),
              types.identifier(`setShowFormMessageComponent_${sanitizedFormId}`),
            ]),
            types.callExpression(types.identifier('useState'), [types.booleanLiteral(false)])
          ),
        ]),
        // const [showSuccessComponent_${sanitizedFormId}, setShowSuccessComponent_${sanitizedFormId}] = useState(false)
        types.variableDeclaration('const', [
          types.variableDeclarator(
            types.arrayPattern([
              types.identifier(`showSuccessComponent_${sanitizedFormId}`),
              types.identifier(`setShowSuccessComponent_${sanitizedFormId}`),
            ]),
            types.callExpression(types.identifier('useState'), [types.booleanLiteral(false)])
          ),
        ]),
        // const [showErrorComponent_${sanitizedFormId}, setShowErrorComponent_${sanitizedFormId}] = useState(false)
        types.variableDeclaration('const', [
          types.variableDeclarator(
            types.arrayPattern([
              types.identifier(`showErrorComponent_${sanitizedFormId}`),
              types.identifier(`setShowErrorComponent_${sanitizedFormId}`),
            ]),
            types.callExpression(types.identifier('useState'), [types.booleanLiteral(false)])
          ),
        ]),
        // const [showLimitComponent_${sanitizedFormId}, setShowLimitComponent_${sanitizedFormId}] = useState(false)
        types.variableDeclaration('const', [
          types.variableDeclarator(
            types.arrayPattern([
              types.identifier(`showLimitComponent_${sanitizedFormId}`),
              types.identifier(`setShowLimitComponent_${sanitizedFormId}`),
            ]),
            types.callExpression(types.identifier('useState'), [types.booleanLiteral(false)])
          ),
        ]),
        // const [formStartTime_${sanitizedFormId}, setFormStartTime_${sanitizedFormId}] = useState<number | null>(null)
        types.variableDeclaration('const', [
          types.variableDeclarator(
            types.arrayPattern([
              types.identifier(`formStartTime_${sanitizedFormId}`),
              types.identifier(`setFormStartTime_${sanitizedFormId}`),
            ]),
            types.callExpression(types.identifier('useState'), [types.nullLiteral()])
          ),
        ]),
      ]

      // Create form submission handler function (pass forms config and both original and sanitized IDs)
      const handleSubmitFunction = createFormSubmitHandler(
        formId,
        sanitizedFormId,
        formDefinition,
        forms
      )

      // Add useEffect to track form interaction start time
      const useEffectForFormStart = types.expressionStatement(
        types.callExpression(types.identifier('useEffect'), [
          types.arrowFunctionExpression(
            [],
            types.blockStatement([
              types.variableDeclaration('const', [
                types.variableDeclarator(
                  types.identifier('handleFirstInteraction'),
                  types.arrowFunctionExpression(
                    [],
                    types.blockStatement([
                      types.ifStatement(
                        types.binaryExpression(
                          '===',
                          types.identifier(`formStartTime_${sanitizedFormId}`),
                          types.nullLiteral()
                        ),
                        types.blockStatement([
                          types.expressionStatement(
                            types.callExpression(
                              types.identifier(`setFormStartTime_${sanitizedFormId}`),
                              [
                                types.callExpression(
                                  types.memberExpression(
                                    types.identifier('Date'),
                                    types.identifier('now')
                                  ),
                                  []
                                ),
                              ]
                            )
                          ),
                        ])
                      ),
                    ])
                  )
                ),
              ]),
              types.variableDeclaration('const', [
                types.variableDeclarator(
                  types.identifier('formElement'),
                  types.callExpression(
                    types.memberExpression(
                      types.identifier('document'),
                      types.identifier('querySelector')
                    ),
                    [types.stringLiteral(`form[data-form-id="${formId}"]`)]
                  )
                ),
              ]),
              types.ifStatement(
                types.identifier('formElement'),
                types.blockStatement([
                  types.expressionStatement(
                    types.callExpression(
                      types.memberExpression(
                        types.identifier('formElement'),
                        types.identifier('addEventListener')
                      ),
                      [
                        types.stringLiteral('focusin'),
                        types.identifier('handleFirstInteraction'),
                        types.objectExpression([
                          types.objectProperty(
                            types.identifier('once'),
                            types.booleanLiteral(true)
                          ),
                        ]),
                      ]
                    )
                  ),
                  types.returnStatement(
                    types.arrowFunctionExpression(
                      [],
                      types.blockStatement([
                        types.expressionStatement(
                          types.callExpression(
                            types.memberExpression(
                              types.identifier('formElement'),
                              types.identifier('removeEventListener')
                            ),
                            [
                              types.stringLiteral('focusin'),
                              types.identifier('handleFirstInteraction'),
                            ]
                          )
                        ),
                      ])
                    )
                  ),
                ])
              ),
            ])
          ),
          types.arrayExpression([types.identifier(`formStartTime_${sanitizedFormId}`)]),
        ])
      )

      // Add useEffect dependency
      if (!structure.dependencies.useEffect) {
        structure.dependencies.useEffect = {
          type: 'library',
          path: 'react',
          version: '^17.0.2',
          meta: {
            namedImport: true,
          },
        }
      }

      componentBody.body.unshift(...stateDeclarations, useEffectForFormStart, handleSubmitFunction)

      // Find the form JSX element in the AST and add onSubmit attribute
      // Also find and disable the submit button while form is submitting
      const returnStatement = componentBody.body.find(
        (statement) =>
          statement.type === 'ReturnStatement' && statement.argument && 'type' in statement.argument
      ) as types.ReturnStatement | undefined

      if (returnStatement && returnStatement.argument) {
        let isInsideTargetForm = false

        const traverseJSX = (node: types.Node): void => {
          if (node.type === 'JSXElement') {
            const jsxElement = node as types.JSXElement
            const openingElement = jsxElement.openingElement

            if (
              openingElement &&
              openingElement.name.type === 'JSXIdentifier' &&
              openingElement.name.name === 'form'
            ) {
              // Check if this is our form by looking for data-form-id attribute
              const hasFormId = openingElement.attributes?.some(
                (attr) =>
                  attr.type === 'JSXAttribute' &&
                  attr.name.type === 'JSXIdentifier' &&
                  attr.name.name === 'data-form-id' &&
                  attr.value?.type === 'StringLiteral' &&
                  'value' in attr.value &&
                  attr.value.value === formId
              )

              if (hasFormId) {
                // Add onSubmit handler
                openingElement.attributes.push(
                  types.jsxAttribute(
                    types.jsxIdentifier('onSubmit'),
                    types.jsxExpressionContainer(
                      types.identifier(`handleFormSubmit_${sanitizedFormId}`)
                    )
                  )
                )

                // Mark that we're now inside the target form
                isInsideTargetForm = true

                // Traverse children to find submit button
                if (jsxElement.children) {
                  jsxElement.children.forEach((child) => traverseJSX(child as types.Node))
                }

                // Mark that we've exited the form
                isInsideTargetForm = false
                return // Don't continue traversing after we've handled the form
              }
            }

            // If we're inside the target form, look for submit buttons
            if (
              isInsideTargetForm &&
              openingElement &&
              openingElement.name.type === 'JSXIdentifier' &&
              openingElement.name.name === 'button'
            ) {
              // Check if this is a submit button
              const isSubmitButton = openingElement.attributes?.some(
                (attr) =>
                  attr.type === 'JSXAttribute' &&
                  attr.name.type === 'JSXIdentifier' &&
                  attr.name.name === 'type' &&
                  attr.value?.type === 'StringLiteral' &&
                  'value' in attr.value &&
                  attr.value.value === 'submit'
              )

              if (isSubmitButton) {
                // Add disabled attribute based on form submitting state
                openingElement.attributes.push(
                  types.jsxAttribute(
                    types.jsxIdentifier('disabled'),
                    types.jsxExpressionContainer(
                      types.identifier(`formSubmitting_${sanitizedFormId}`)
                    )
                  )
                )
              }
            }
          }

          // Recursively traverse children only if we haven't already handled them
          if (!isInsideTargetForm && 'children' in node && Array.isArray(node.children)) {
            node.children.forEach((child) => traverseJSX(child as types.Node))
          }
          if ('argument' in node && node.argument) {
            traverseJSX(node.argument as types.Node)
          }
          if ('expression' in node && node.expression) {
            traverseJSX(node.expression as types.Node)
          }
        }

        traverseJSX(returnStatement.argument)
      }

      // Add success and error component rendering after the form if needed
      if (successMessage?.type === 'component-ref' || errorMessage?.type === 'component-ref') {
        // Find the JSX component chunk and modify it to add components after the form
        const jsxChunk = chunks.find(
          (chunk) =>
            chunk.name === 'jsx-component' &&
            typeof chunk.content === 'object' &&
            'type' in chunk.content &&
            chunk.content.type === 'VariableDeclaration'
        )

        if (jsxChunk && jsxChunk.content) {
          const componentBodyForAddingComponents = (
            (
              (jsxChunk.content as types.VariableDeclaration)
                .declarations[0] as types.VariableDeclarator
            ).init as types.ArrowFunctionExpression
          ).body as types.BlockStatement

          const returnStatementForAddingComponents = componentBodyForAddingComponents.body.find(
            (statement) =>
              statement.type === 'ReturnStatement' &&
              statement.argument &&
              'type' in statement.argument
          ) as types.ReturnStatement | undefined

          if (returnStatementForAddingComponents && returnStatementForAddingComponents.argument) {
            // Find the form element and add components after it
            // We need to track parents manually during traversal
            const findAndAddComponents = (
              node: types.Node,
              parent: types.Node | null = null
            ): boolean => {
              if (node.type === 'JSXElement') {
                const jsxElement = node as types.JSXElement
                const openingElement = jsxElement.openingElement

                if (
                  openingElement &&
                  openingElement.name.type === 'JSXIdentifier' &&
                  openingElement.name.name === 'form'
                ) {
                  // Check if this is our form by looking for data-form-id attribute
                  const hasFormId = openingElement.attributes?.some(
                    (attr) =>
                      attr.type === 'JSXAttribute' &&
                      attr.name.type === 'JSXIdentifier' &&
                      attr.name.name === 'data-form-id' &&
                      attr.value?.type === 'StringLiteral' &&
                      'value' in attr.value &&
                      attr.value.value === formId
                  )

                  if (hasFormId) {
                    // Create components to add after the form
                    const componentsToAdd: types.JSXElement[] = []

                    // Add success component
                    if (successMessage?.type === 'component-ref') {
                      const componentId = successMessage.componentId?.content as string
                      const componentInfo = getComponentInfo(componentId)

                      if (!componentInfo) {
                        console.warn(`Cannot render success component: ${componentId} not found`)
                        return false
                      }

                      const successComponent = types.jsxElement(
                        types.jsxOpeningElement(
                          types.jsxIdentifier(componentInfo.componentClassName),
                          [],
                          true
                        ),
                        null,
                        [],
                        true
                      )

                      const successConditional = types.jsxElement(
                        types.jsxOpeningElement(
                          types.jsxIdentifier('div'),
                          [
                            types.jsxAttribute(
                              types.jsxIdentifier('style'),
                              types.jsxExpressionContainer(
                                types.objectExpression([
                                  types.objectProperty(
                                    types.identifier('display'),
                                    types.conditionalExpression(
                                      types.identifier(`showSuccessComponent_${sanitizedFormId}`),
                                      types.stringLiteral('block'),
                                      types.stringLiteral('none')
                                    )
                                  ),
                                ])
                              )
                            ),
                          ],
                          false
                        ),
                        types.jsxClosingElement(types.jsxIdentifier('div')),
                        [successComponent],
                        false
                      )

                      componentsToAdd.push(successConditional)
                    }

                    // Add error component
                    if (errorMessage?.type === 'component-ref') {
                      const componentId = errorMessage.componentId?.content as string
                      const componentInfo = getComponentInfo(componentId)

                      if (!componentInfo) {
                        console.warn(`Cannot render error component: ${componentId} not found`)
                        return false
                      }

                      const errorComponent = types.jsxElement(
                        types.jsxOpeningElement(
                          types.jsxIdentifier(componentInfo.componentClassName),
                          [],
                          true
                        ),
                        null,
                        [],
                        true
                      )

                      const errorConditional = types.jsxElement(
                        types.jsxOpeningElement(
                          types.jsxIdentifier('div'),
                          [
                            types.jsxAttribute(
                              types.jsxIdentifier('style'),
                              types.jsxExpressionContainer(
                                types.objectExpression([
                                  types.objectProperty(
                                    types.identifier('display'),
                                    types.conditionalExpression(
                                      types.identifier(`showErrorComponent_${sanitizedFormId}`),
                                      types.stringLiteral('block'),
                                      types.stringLiteral('none')
                                    )
                                  ),
                                ])
                              )
                            ),
                          ],
                          false
                        ),
                        types.jsxClosingElement(types.jsxIdentifier('div')),
                        [errorComponent],
                        false
                      )

                      componentsToAdd.push(errorConditional)
                    }

                    // Add limit component
                    if (limitMessage?.type === 'component-ref') {
                      const componentId = limitMessage.componentId?.content as string
                      const componentInfo = getComponentInfo(componentId)

                      if (!componentInfo) {
                        console.warn(`Cannot render limit component: ${componentId} not found`)
                        return false
                      }

                      const limitComponent = types.jsxElement(
                        types.jsxOpeningElement(
                          types.jsxIdentifier(componentInfo.componentClassName),
                          [],
                          true
                        ),
                        null,
                        [],
                        true
                      )

                      const limitConditional = types.jsxElement(
                        types.jsxOpeningElement(
                          types.jsxIdentifier('div'),
                          [
                            types.jsxAttribute(
                              types.jsxIdentifier('style'),
                              types.jsxExpressionContainer(
                                types.objectExpression([
                                  types.objectProperty(
                                    types.identifier('display'),
                                    types.conditionalExpression(
                                      types.identifier(`showLimitComponent_${sanitizedFormId}`),
                                      types.stringLiteral('block'),
                                      types.stringLiteral('none')
                                    )
                                  ),
                                ])
                              )
                            ),
                          ],
                          false
                        ),
                        types.jsxClosingElement(types.jsxIdentifier('div')),
                        [limitComponent],
                        false
                      )

                      componentsToAdd.push(limitConditional)
                    }

                    // Add components after the form by finding it in the parent's children array
                    if (
                      componentsToAdd.length > 0 &&
                      parent &&
                      'children' in parent &&
                      Array.isArray(parent.children)
                    ) {
                      const formIndex = parent.children.indexOf(node)
                      if (formIndex >= 0) {
                        // Insert components after the form
                        parent.children.splice(formIndex + 1, 0, ...componentsToAdd)
                      }
                    }

                    return true // Found and processed the form
                  }
                }
              }

              // Recursively traverse children, passing current node as parent
              if ('children' in node && Array.isArray(node.children)) {
                for (const child of node.children) {
                  if (findAndAddComponents(child as types.Node, node)) {
                    return true // Found the form, stop searching
                  }
                }
              }
              if ('argument' in node && node.argument) {
                return findAndAddComponents(node.argument as types.Node, node)
              }
              if ('expression' in node && node.expression) {
                return findAndAddComponents(node.expression as types.Node, node)
              }

              return false
            }

            findAndAddComponents(returnStatementForAddingComponents.argument, null)
          }
        }
      }
    }

    return structure
  }

  return nextFormSubmissionHandler
}

function createFormSubmitHandler(
  formId: string,
  sanitizedFormId: string,
  formDefinition: UIDLFormDefinition,
  forms: UIDLForms
): types.VariableDeclaration {
  const t = types

  // Get field IDs from form definition
  const fieldIds = Object.keys(formDefinition.fields || {})

  // Create FormData collection logic
  const formDataStatements: types.Statement[] = [
    // e.preventDefault()
    t.expressionStatement(
      t.callExpression(t.memberExpression(t.identifier('e'), t.identifier('preventDefault')), [])
    ),
    // setFormSubmitting_${sanitizedFormId}(true)
    t.expressionStatement(
      t.callExpression(t.identifier(`setFormSubmitting_${sanitizedFormId}`), [
        t.booleanLiteral(true),
      ])
    ),
    // setFormMessage_${sanitizedFormId}('')
    t.expressionStatement(
      t.callExpression(t.identifier(`setFormMessage_${sanitizedFormId}`), [t.stringLiteral('')])
    ),
  ]

  // Check for expiration date in constraints
  const expirationDate = formDefinition.constraints?.expirationDate?.content
  if (expirationDate) {
    // if (new Date() > new Date('expirationDate')) { ... }
    formDataStatements.push(
      t.ifStatement(
        t.binaryExpression(
          '>',
          t.newExpression(t.identifier('Date'), []),
          t.newExpression(t.identifier('Date'), [t.stringLiteral(expirationDate as string)])
        ),
        t.blockStatement([
          t.expressionStatement(
            t.callExpression(t.identifier(`setFormSubmitting_${sanitizedFormId}`), [
              t.booleanLiteral(false),
            ])
          ),
          // Handle expiration as a limit reached scenario
          ...createLimitHandler(sanitizedFormId, formDefinition.behaviors?.onLimit, formDefinition),
          t.returnStatement(),
        ])
      )
    )
  }

  formDataStatements.push(
    // Bot prevention: Check if form was filled too quickly (< 2 seconds)
    t.ifStatement(
      t.binaryExpression('!==', t.identifier(`formStartTime_${sanitizedFormId}`), t.nullLiteral()),
      t.blockStatement([
        t.variableDeclaration('const', [
          t.variableDeclarator(
            t.identifier('timeTaken'),
            t.binaryExpression(
              '-',
              t.callExpression(t.memberExpression(t.identifier('Date'), t.identifier('now')), []),
              t.identifier(`formStartTime_${sanitizedFormId}`)
            )
          ),
        ]),
        t.ifStatement(
          t.binaryExpression('<', t.identifier('timeTaken'), t.numericLiteral(2000)),
          t.blockStatement([
            t.expressionStatement(
              t.callExpression(t.identifier(`setFormSubmitting_${sanitizedFormId}`), [
                t.booleanLiteral(false),
              ])
            ),
            t.expressionStatement(
              t.callExpression(t.identifier(`setFormMessage_${sanitizedFormId}`), [
                t.stringLiteral('Please take your time to fill out the form.'),
              ])
            ),
            t.returnStatement(),
          ])
        ),
      ])
    )
  )

  // const formData = new FormData(e.target)
  formDataStatements.push(
    t.variableDeclaration('const', [
      t.variableDeclarator(
        t.identifier('formData'),
        t.newExpression(t.identifier('FormData'), [
          t.memberExpression(t.identifier('e'), t.identifier('target')),
        ])
      ),
    ])
  )

  // const data = {}
  formDataStatements.push(
    t.variableDeclaration('const', [
      t.variableDeclarator(t.identifier('data'), t.objectExpression([])),
    ])
  )

  // Add field collection logic
  fieldIds.forEach((fieldId) => {
    const field = formDefinition.fields[fieldId]
    const fieldName = String(field.name?.content || fieldId)
    const fieldDomId = String(field.id?.content || fieldId)

    // data[fieldDomId] = formData.get(fieldName)
    formDataStatements.push(
      t.expressionStatement(
        t.assignmentExpression(
          '=',
          t.memberExpression(t.identifier('data'), t.stringLiteral(fieldDomId), true),
          t.callExpression(t.memberExpression(t.identifier('formData'), t.identifier('get')), [
            t.stringLiteral(fieldName),
          ])
        )
      )
    )
  })

  // Get captcha configuration (form-specific or global)
  const captchaKey =
    formDefinition.security?.captchaPublicKey || forms.globalConfig?.defaultCaptchaPublicKey
  const captchaProvider = forms.globalConfig?.captchaProvider || 'recaptcha'

  // Determine if using default (enterprise) or form-specific captcha
  const usingDefaultCaptcha =
    !formDefinition.security?.captchaPublicKey && forms.globalConfig?.defaultCaptchaPublicKey

  // Add captcha token if captcha is configured
  if (captchaKey) {
    let captchaKeyExpression: types.Expression
    if (captchaKey.type === 'static') {
      captchaKeyExpression = t.stringLiteral(captchaKey.content as string)
    } else if (captchaKey.type === 'env') {
      captchaKeyExpression = t.memberExpression(
        t.memberExpression(t.identifier('process'), t.identifier('env')),
        t.identifier(captchaKey.content as string)
      )
    } else {
      captchaKeyExpression = t.stringLiteral('')
    }

    // Determine the correct API call based on provider and enterprise mode
    let captchaExecuteExpression: types.Expression

    if (captchaProvider === 'recaptcha') {
      if (usingDefaultCaptcha) {
        // Enterprise reCAPTCHA: grecaptcha.enterprise.execute()
        captchaExecuteExpression = t.callExpression(
          t.memberExpression(
            t.memberExpression(
              t.memberExpression(t.identifier('window'), t.identifier('grecaptcha')),
              t.identifier('enterprise')
            ),
            t.identifier('execute')
          ),
          [
            captchaKeyExpression,
            t.objectExpression([
              t.objectProperty(t.identifier('action'), t.stringLiteral('submit')),
            ]),
          ]
        )
      } else {
        // Standard reCAPTCHA: grecaptcha.execute()
        captchaExecuteExpression = t.callExpression(
          t.memberExpression(
            t.memberExpression(t.identifier('window'), t.identifier('grecaptcha')),
            t.identifier('execute')
          ),
          [
            captchaKeyExpression,
            t.objectExpression([
              t.objectProperty(t.identifier('action'), t.stringLiteral('submit')),
            ]),
          ]
        )
      }
    } else {
      // Other providers (hcaptcha, turnstile)
      captchaExecuteExpression = t.callExpression(
        t.memberExpression(
          t.memberExpression(t.identifier('window'), t.identifier(captchaProvider)),
          t.identifier('execute')
        ),
        [captchaKeyExpression]
      )
    }

    // Add captcha verification (wrapped in conditional and try/catch)
    formDataStatements.push(
      // if (captchaKey) { try { ... } catch { ... } }
      t.ifStatement(
        captchaKeyExpression,
        t.blockStatement([
          t.tryStatement(
            t.blockStatement([
              // const captchaToken = await [appropriate API call]
              t.variableDeclaration('const', [
                t.variableDeclarator(
                  t.identifier('captchaToken'),
                  t.awaitExpression(captchaExecuteExpression)
                ),
              ]),
              // data['captchaToken'] = captchaToken
              t.expressionStatement(
                t.assignmentExpression(
                  '=',
                  t.memberExpression(t.identifier('data'), t.stringLiteral('captchaToken'), true),
                  t.identifier('captchaToken')
                )
              ),
            ]),
            // catch (captchaError) { console.error('Captcha error:', captchaError) }
            t.catchClause(
              t.identifier('captchaError'),
              t.blockStatement([
                t.expressionStatement(
                  t.callExpression(
                    t.memberExpression(t.identifier('console'), t.identifier('error')),
                    [t.stringLiteral('Captcha verification failed:'), t.identifier('captchaError')]
                  )
                ),
              ])
            )
          ),
        ])
      )
    )
  }

  // Determine the API URL (use formsServerUrl if available, otherwise use env variable)
  // The URL will have the format: ${baseUrl}/${formId}
  let apiUrlExpression: types.Expression
  const formsServerUrl = forms.formsServerUrl

  if (formsServerUrl) {
    if (formsServerUrl.type === 'static') {
      // For static URL, just concatenate the strings directly
      apiUrlExpression = t.stringLiteral(`${formsServerUrl.content}/${formId}`)
    } else if (formsServerUrl.type === 'env') {
      // For env variable, create a template literal: `${process.env.VAR}/${formId}`
      apiUrlExpression = t.templateLiteral(
        [
          t.templateElement({ raw: '', cooked: '' }, false),
          t.templateElement({ raw: `/${formId}`, cooked: `/${formId}` }, true),
        ],
        [
          t.memberExpression(
            t.memberExpression(t.identifier('process'), t.identifier('env')),
            t.identifier(formsServerUrl.content as string)
          ),
        ]
      )
    } else {
      // Fallback to default env variable
      apiUrlExpression = t.templateLiteral(
        [
          t.templateElement({ raw: '', cooked: '' }, false),
          t.templateElement({ raw: `/${formId}`, cooked: `/${formId}` }, true),
        ],
        [
          t.memberExpression(
            t.memberExpression(t.identifier('process'), t.identifier('env')),
            t.identifier('NEXT_PUBLIC_FORMS_API_URL')
          ),
        ]
      )
    }
  } else {
    // Default to env variable with formId appended
    apiUrlExpression = t.templateLiteral(
      [
        t.templateElement({ raw: '', cooked: '' }, false),
        t.templateElement({ raw: `/${formId}`, cooked: `/${formId}` }, true),
      ],
      [
        t.memberExpression(
          t.memberExpression(t.identifier('process'), t.identifier('env')),
          t.identifier('NEXT_PUBLIC_FORMS_API_URL')
        ),
      ]
    )
  }

  // Create fetch request
  const fetchCall = t.tryStatement(
    t.blockStatement([
      // const response = await fetch(apiUrl, {...})
      t.variableDeclaration('const', [
        t.variableDeclarator(
          t.identifier('response'),
          t.awaitExpression(
            t.callExpression(t.identifier('fetch'), [
              apiUrlExpression,
              t.objectExpression([
                t.objectProperty(t.identifier('method'), t.stringLiteral('POST')),
                t.objectProperty(
                  t.identifier('headers'),
                  t.objectExpression([
                    t.objectProperty(
                      t.stringLiteral('Content-Type'),
                      t.stringLiteral('application/json')
                    ),
                  ])
                ),
                t.objectProperty(
                  t.identifier('body'),
                  t.callExpression(
                    t.memberExpression(t.identifier('JSON'), t.identifier('stringify')),
                    [
                      t.objectExpression([
                        t.objectProperty(t.identifier('formId'), t.stringLiteral(formId)),
                        t.spreadElement(t.identifier('data')),
                      ]),
                    ]
                  )
                ),
              ]),
            ])
          )
        ),
      ]),
      // if (!response.ok) parse error and throw (check before parsing result JSON)
      t.ifStatement(
        t.unaryExpression('!', t.memberExpression(t.identifier('response'), t.identifier('ok'))),
        t.blockStatement([
          // let errorMessage = 'Form submission failed'
          t.variableDeclaration('let', [
            t.variableDeclarator(
              t.identifier('errorMessage'),
              t.stringLiteral('Form submission failed')
            ),
          ]),
          // try { const errorData = await response.json(); if (errorData && (errorData.message || errorData.error)) { errorMessage = errorData.message || errorData.error } } catch (_) {}
          t.tryStatement(
            t.blockStatement([
              t.variableDeclaration('const', [
                t.variableDeclarator(
                  t.identifier('errorData'),
                  t.awaitExpression(
                    t.callExpression(
                      t.memberExpression(t.identifier('response'), t.identifier('json')),
                      []
                    )
                  )
                ),
              ]),
              t.ifStatement(
                t.logicalExpression(
                  '&&',
                  t.identifier('errorData'),
                  t.logicalExpression(
                    '||',
                    t.memberExpression(t.identifier('errorData'), t.identifier('message')),
                    t.memberExpression(t.identifier('errorData'), t.identifier('error'))
                  )
                ),
                t.blockStatement([
                  t.expressionStatement(
                    t.assignmentExpression(
                      '=',
                      t.identifier('errorMessage'),
                      t.logicalExpression(
                        '||',
                        t.memberExpression(t.identifier('errorData'), t.identifier('message')),
                        t.memberExpression(t.identifier('errorData'), t.identifier('error'))
                      )
                    )
                  ),
                ])
              ),
            ]),
            t.catchClause(t.identifier('_'), t.blockStatement([]))
          ),
          // throw new Error(errorMessage)
          t.throwStatement(t.newExpression(t.identifier('Error'), [t.identifier('errorMessage')])),
        ])
      ),
      // Parse response and check for errors including limit reached
      t.variableDeclaration('const', [
        t.variableDeclarator(
          t.identifier('result'),
          t.awaitExpression(
            t.callExpression(t.memberExpression(t.identifier('response'), t.identifier('json')), [])
          )
        ),
      ]),
      // Check for limit reached error (result.success === false && message includes "limit reached")
      t.ifStatement(
        t.logicalExpression(
          '&&',
          t.logicalExpression(
            '&&',
            t.binaryExpression(
              '===',
              t.memberExpression(t.identifier('result'), t.identifier('success')),
              t.booleanLiteral(false)
            ),
            t.memberExpression(t.identifier('result'), t.identifier('message'))
          ),
          t.callExpression(
            t.memberExpression(
              t.callExpression(
                t.memberExpression(
                  t.memberExpression(t.identifier('result'), t.identifier('message')),
                  t.identifier('toLowerCase')
                ),
                []
              ),
              t.identifier('includes')
            ),
            [t.stringLiteral('limit reached')]
          )
        ),
        t.blockStatement([
          // Handle onLimit behavior
          ...createLimitHandler(sanitizedFormId, formDefinition.behaviors?.onLimit, formDefinition),
          t.returnStatement(),
        ])
      ),
      // Check for other errors when result.success === false (but not limit reached)
      t.ifStatement(
        t.binaryExpression(
          '===',
          t.memberExpression(t.identifier('result'), t.identifier('success')),
          t.booleanLiteral(false)
        ),
        t.blockStatement([
          // Handle onError behavior
          ...createErrorHandler(sanitizedFormId, formDefinition.behaviors.onError, formDefinition),
          t.returnStatement(),
        ])
      ),
      // Handle success behavior
      ...createSuccessHandler(sanitizedFormId, formDefinition.behaviors.onSuccess, formDefinition),
    ]),
    // catch block
    t.catchClause(
      t.identifier('error'),
      t.blockStatement([
        t.expressionStatement(
          t.callExpression(t.memberExpression(t.identifier('console'), t.identifier('error')), [
            t.stringLiteral('Form submission error:'),
            t.identifier('error'),
          ])
        ),
        // Check if error message contains "limit reached"
        t.ifStatement(
          t.logicalExpression(
            '&&',
            t.memberExpression(t.identifier('error'), t.identifier('message')),
            t.callExpression(
              t.memberExpression(
                t.callExpression(
                  t.memberExpression(
                    t.memberExpression(t.identifier('error'), t.identifier('message')),
                    t.identifier('toLowerCase')
                  ),
                  []
                ),
                t.identifier('includes')
              ),
              [t.stringLiteral('limit reached')]
            )
          ),
          t.blockStatement([
            // Handle onLimit behavior
            ...createLimitHandler(
              sanitizedFormId,
              formDefinition.behaviors?.onLimit,
              formDefinition
            ),
          ]),
          t.blockStatement([
            // Handle onError behavior
            ...createErrorHandler(
              sanitizedFormId,
              formDefinition.behaviors.onError,
              formDefinition
            ),
          ])
        ),
      ])
    ),
    // finally block
    t.blockStatement([
      t.expressionStatement(
        t.callExpression(t.identifier(`setFormSubmitting_${sanitizedFormId}`), [
          t.booleanLiteral(false),
        ])
      ),
    ])
  )

  // Combine all statements
  const allStatements = [...formDataStatements, fetchCall]

  // const handleFormSubmit_${sanitizedFormId} = async (e) => { ... }
  return t.variableDeclaration('const', [
    t.variableDeclarator(
      t.identifier(`handleFormSubmit_${sanitizedFormId}`),
      t.arrowFunctionExpression(
        [t.identifier('e')],
        t.blockStatement(allStatements),
        true // async
      )
    ),
  ])
}

/**
 * Creates success handler based on form behavior configuration
 * @param sanitizedFormId - Sanitized form ID for JavaScript identifiers
 * @param behavior - Form behavior configuration
 * @param formDefinition - The complete form definition containing messages
 */
function createSuccessHandler(
  sanitizedFormId: string,
  behavior: UIDLFormBehavior,
  formDefinition: UIDLFormDefinition
): types.Statement[] {
  const t = types
  const statements: types.Statement[] = []

  switch (behavior.action) {
    case 'clear-form':
      statements.push(
        t.expressionStatement(
          t.callExpression(
            t.memberExpression(
              t.memberExpression(t.identifier('e'), t.identifier('target')),
              t.identifier('reset')
            ),
            []
          )
        )
      )
      break

    case 'clear-form-and-alert':
      const message = behavior.details?.message
      if (message?.type === 'component-ref') {
        // Show success component
        statements.push(
          t.expressionStatement(
            t.callExpression(
              t.memberExpression(
                t.memberExpression(t.identifier('e'), t.identifier('target')),
                t.identifier('reset')
              ),
              []
            )
          ),
          t.expressionStatement(
            t.callExpression(t.identifier(`setShowSuccessComponent_${sanitizedFormId}`), [
              t.booleanLiteral(true),
            ])
          )
        )
      } else {
        // Show static message with alert from formDefinition.messages.success
        const msgContent = String(
          formDefinition.messages?.success?.content || 'Form submitted successfully!'
        )
        statements.push(
          t.expressionStatement(
            t.callExpression(
              t.memberExpression(
                t.memberExpression(t.identifier('e'), t.identifier('target')),
                t.identifier('reset')
              ),
              []
            )
          ),
          t.expressionStatement(
            t.callExpression(t.memberExpression(t.identifier('window'), t.identifier('alert')), [
              t.stringLiteral(msgContent),
            ])
          )
        )
      }
      break

    case 'message':
      // Reset form on successful submission
      statements.push(
        t.expressionStatement(
          t.callExpression(
            t.memberExpression(
              t.memberExpression(t.identifier('e'), t.identifier('target')),
              t.identifier('reset')
            ),
            []
          )
        )
      )

      const msgDetails = behavior.details?.message
      if (msgDetails?.type === 'component-ref') {
        // Show success component
        statements.push(
          t.expressionStatement(
            t.callExpression(t.identifier(`setShowSuccessComponent_${sanitizedFormId}`), [
              t.booleanLiteral(true),
            ])
          )
        )
      } else {
        // Show static message
        const msgContent = String(msgDetails?.content || 'Form submitted successfully!')
        statements.push(
          t.expressionStatement(
            t.callExpression(t.identifier(`setFormMessage_${sanitizedFormId}`), [
              t.stringLiteral(msgContent),
            ])
          )
        )
      }
      break

    case 'redirect-page':
      // Reset form before redirecting
      statements.push(
        t.expressionStatement(
          t.callExpression(
            t.memberExpression(
              t.memberExpression(t.identifier('e'), t.identifier('target')),
              t.identifier('reset')
            ),
            []
          )
        )
      )

      const pageId = behavior.details?.url?.content
      if (pageId) {
        // window.location.href = '/page'
        statements.push(
          t.expressionStatement(
            t.assignmentExpression(
              '=',
              t.memberExpression(
                t.memberExpression(t.identifier('window'), t.identifier('location')),
                t.identifier('href')
              ),
              t.stringLiteral(String(pageId))
            )
          )
        )
      }
      break

    case 'redirect-url':
      // Reset form before redirecting
      statements.push(
        t.expressionStatement(
          t.callExpression(
            t.memberExpression(
              t.memberExpression(t.identifier('e'), t.identifier('target')),
              t.identifier('reset')
            ),
            []
          )
        )
      )

      const url = behavior.details?.url?.content
      if (url) {
        statements.push(
          t.expressionStatement(
            t.assignmentExpression(
              '=',
              t.memberExpression(
                t.memberExpression(t.identifier('window'), t.identifier('location')),
                t.identifier('href')
              ),
              t.stringLiteral(String(url))
            )
          )
        )
      }
      break

    default:
      // No action needed for unknown behavior
      break
  }

  return statements
}

/**
 * Creates error handler based on form behavior configuration
 * @param sanitizedFormId - Sanitized form ID for JavaScript identifiers
 * @param behavior - Form behavior configuration
 * @param formDefinition - The complete form definition containing messages
 */
function createErrorHandler(
  sanitizedFormId: string,
  behavior: UIDLFormBehavior,
  formDefinition: UIDLFormDefinition
): types.Statement[] {
  const t = types
  const statements: types.Statement[] = []

  switch (behavior.action) {
    case 'clear-form':
      statements.push(
        t.expressionStatement(
          t.callExpression(
            t.memberExpression(
              t.memberExpression(t.identifier('e'), t.identifier('target')),
              t.identifier('reset')
            ),
            []
          )
        )
      )
      break

    case 'clear-form-and-alert':
      const message = behavior.details?.message
      if (message?.type === 'component-ref') {
        // Show error component
        statements.push(
          t.expressionStatement(
            t.callExpression(
              t.memberExpression(
                t.memberExpression(t.identifier('e'), t.identifier('target')),
                t.identifier('reset')
              ),
              []
            )
          ),
          t.expressionStatement(
            t.callExpression(t.identifier(`setShowErrorComponent_${sanitizedFormId}`), [
              t.booleanLiteral(true),
            ])
          )
        )
      } else {
        // Show static message from formDefinition.messages.error
        const msgContent = String(
          formDefinition.messages?.error?.content || 'An error occurred. Please try again.'
        )
        statements.push(
          t.expressionStatement(
            t.callExpression(
              t.memberExpression(
                t.memberExpression(t.identifier('e'), t.identifier('target')),
                t.identifier('reset')
              ),
              []
            )
          ),
          t.expressionStatement(
            t.callExpression(t.memberExpression(t.identifier('window'), t.identifier('alert')), [
              t.stringLiteral(msgContent),
            ])
          )
        )
      }
      break

    case 'message':
      const msgDetails = behavior.details?.message
      if (msgDetails?.type === 'component-ref') {
        // Show error component
        statements.push(
          t.expressionStatement(
            t.callExpression(t.identifier(`setShowErrorComponent_${sanitizedFormId}`), [
              t.booleanLiteral(true),
            ])
          )
        )
      } else {
        // Show static message
        const msgContent = String(msgDetails?.content || 'An error occurred. Please try again.')
        statements.push(
          t.expressionStatement(
            t.callExpression(t.identifier(`setFormMessage_${sanitizedFormId}`), [
              t.stringLiteral(msgContent),
            ])
          )
        )
      }
      break

    case 'redirect-page':
      const pageId = behavior.details?.url?.content
      if (pageId) {
        // window.location.href = '/page'
        statements.push(
          t.expressionStatement(
            t.assignmentExpression(
              '=',
              t.memberExpression(
                t.memberExpression(t.identifier('window'), t.identifier('location')),
                t.identifier('href')
              ),
              t.stringLiteral(String(pageId))
            )
          )
        )
      }
      break

    case 'redirect-url':
      const url = behavior.details?.url?.content
      if (url) {
        statements.push(
          t.expressionStatement(
            t.assignmentExpression(
              '=',
              t.memberExpression(
                t.memberExpression(t.identifier('window'), t.identifier('location')),
                t.identifier('href')
              ),
              t.stringLiteral(String(url))
            )
          )
        )
      }
      break

    default:
      // No action needed for unknown behavior
      break
  }

  return statements
}

/**
 * Creates limit handler based on form behavior configuration (when submission limit is reached)
 * @param sanitizedFormId - Sanitized form ID for JavaScript identifiers
 * @param behavior - Form behavior configuration
 * @param formDefinition - The complete form definition containing messages
 */
function createLimitHandler(
  sanitizedFormId: string,
  behavior: UIDLFormBehavior | undefined,
  formDefinition: UIDLFormDefinition
): types.Statement[] {
  const t = types
  const statements: types.Statement[] = []

  // If no behavior defined, return default message
  if (!behavior) {
    return [
      t.expressionStatement(
        t.callExpression(t.identifier(`setFormMessage_${sanitizedFormId}`), [
          t.stringLiteral('This form has reached its submission limit.'),
        ])
      ),
    ]
  }

  switch (behavior.action) {
    case 'clear-form':
      statements.push(
        t.expressionStatement(
          t.callExpression(
            t.memberExpression(
              t.memberExpression(t.identifier('e'), t.identifier('target')),
              t.identifier('reset')
            ),
            []
          )
        )
      )
      break

    case 'clear-form-and-alert':
      const message = behavior.details?.message
      if (message?.type === 'component-ref') {
        // Show limit component
        statements.push(
          t.expressionStatement(
            t.callExpression(
              t.memberExpression(
                t.memberExpression(t.identifier('e'), t.identifier('target')),
                t.identifier('reset')
              ),
              []
            )
          ),
          t.expressionStatement(
            t.callExpression(t.identifier(`setShowLimitComponent_${sanitizedFormId}`), [
              t.booleanLiteral(true),
            ])
          )
        )
      } else {
        // Show static message from formDefinition.messages.limit
        const msgContent = String(
          formDefinition.messages?.limit?.content || 'This form has reached its submission limit.'
        )
        statements.push(
          t.expressionStatement(
            t.callExpression(
              t.memberExpression(
                t.memberExpression(t.identifier('e'), t.identifier('target')),
                t.identifier('reset')
              ),
              []
            )
          ),
          t.expressionStatement(
            t.callExpression(t.memberExpression(t.identifier('window'), t.identifier('alert')), [
              t.stringLiteral(msgContent),
            ])
          )
        )
      }
      break

    case 'message':
      const msgDetails = behavior.details?.message
      if (msgDetails?.type === 'component-ref') {
        // Show limit component
        statements.push(
          t.expressionStatement(
            t.callExpression(t.identifier(`setShowLimitComponent_${sanitizedFormId}`), [
              t.booleanLiteral(true),
            ])
          )
        )
      } else {
        // Show static message
        const msgContent = String(
          msgDetails?.content || 'This form has reached its submission limit.'
        )
        statements.push(
          t.expressionStatement(
            t.callExpression(t.identifier(`setFormMessage_${sanitizedFormId}`), [
              t.stringLiteral(msgContent),
            ])
          )
        )
      }
      break

    case 'redirect-page':
      const pageId = behavior.details?.url?.content
      if (pageId) {
        // window.location.href = '/page'
        statements.push(
          t.expressionStatement(
            t.assignmentExpression(
              '=',
              t.memberExpression(
                t.memberExpression(t.identifier('window'), t.identifier('location')),
                t.identifier('href')
              ),
              t.stringLiteral(String(pageId))
            )
          )
        )
      }
      break

    case 'redirect-url':
      const url = behavior.details?.url?.content
      if (url) {
        statements.push(
          t.expressionStatement(
            t.assignmentExpression(
              '=',
              t.memberExpression(
                t.memberExpression(t.identifier('window'), t.identifier('location')),
                t.identifier('href')
              ),
              t.stringLiteral(String(url))
            )
          )
        )
      }
      break

    default:
      // No action needed for unknown behavior
      break
  }

  return statements
}

import * as types from '@babel/types'
import { StringUtils } from '@teleporthq/teleport-shared'

export const generateLoadingStateAST = (statePersistanceName: string, value: boolean) => {
  const setLoadingState = types.expressionStatement(
    types.callExpression(
      types.identifier(StringUtils.createStateStoringFunction(`${statePersistanceName}Loading`)),
      [types.booleanLiteral(value)]
    )
  )

  return setLoadingState
}

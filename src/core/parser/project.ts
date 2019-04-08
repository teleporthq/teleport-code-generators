import { parseComponentJSON } from './component'

import { ProjectUIDL, ComponentUIDL } from '../../typings/uidl-definitions'
import { cloneObject } from '../../shared/utils/uidl-utils'

interface ParseProjectJSONParams {
  noClone?: boolean
}

export const parseProjectJSON = (
  input: Record<string, unknown>,
  params: ParseProjectJSONParams = {}
): ProjectUIDL => {
  const safeInput = params.noClone ? input : cloneObject(input)
  const root = safeInput.root as ComponentUIDL

  const result = {
    ...(safeInput as ProjectUIDL),
  }

  result.root = parseComponentJSON(root, { noClone: true })
  if (result.components) {
    result.components = Object.keys(result.components).reduce((parsedComponnets, key) => {
      parsedComponnets[key] = parseComponentJSON(result.components[key])
      return parsedComponnets
    }, {})
  }

  return result
}

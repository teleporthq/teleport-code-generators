import { parseComponentJSON } from './component'

import { ProjectUIDL, ComponentUIDL } from '../../typings/uidl-definitions'

export const parseProjectJSON = (input: Record<string, unknown>): ProjectUIDL => {
  const root = input.root as ComponentUIDL
  const components = (input.components || {}) as Record<string, ComponentUIDL>

  const result = {
    ...(input as ProjectUIDL),
  }

  result.root = parseComponentJSON(root)
  if (result.components) {
    result.components = Object.keys(components).reduce((parsedComponnets, key) => {
      parsedComponnets[key] = parseComponentJSON(components[key])
      return parsedComponnets
    }, {})
  }

  return result
}

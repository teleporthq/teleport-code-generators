import { StringUtils } from '@teleporthq/teleport-shared'
import { UIDLResourceItem } from '@teleporthq/teleport-types'

/**
 * The identifier a resource is imported under, which also fixes its file name:
 * `resources/<dash-cased name>.js`, imported as `<camelCased name>Resource`.
 * Two names that agree here would write, or import, the same module.
 */
const moduleKeyOf = (name: string) =>
  StringUtils.dashCaseToCamelCase(StringUtils.camelCaseToDashCase(name))

/**
 * Gives every resource a name no other resource shares.
 *
 * A resource is keyed by its id, but its module is named after `name`, so two
 * resources with one name wrote the same file and the last one won. The editor
 * names a details page's fetchers after the table alone, and the table of every
 * REST API source is `data`: with two such details pages, one page read the
 * other's records and answered every link with a 404.
 *
 * The first resource keeps its name; each later one gets the lowest number
 * suffix that no resource uses yet, so a project without clashes is unchanged.
 */
export const ensureUniqueResourceNames = (
  items: Record<string, UIDLResourceItem>
): Record<string, UIDLResourceItem> => {
  const originalKeys = new Set(Object.values(items).map((resource) => moduleKeyOf(resource.name)))
  const claimedKeys = new Set<string>()

  return Object.keys(items).reduce((acc: Record<string, UIDLResourceItem>, id) => {
    const resource = items[id]
    let name = resource.name

    if (claimedKeys.has(moduleKeyOf(name))) {
      let suffix = 2
      while (
        claimedKeys.has(moduleKeyOf(`${resource.name}${suffix}`)) ||
        originalKeys.has(moduleKeyOf(`${resource.name}${suffix}`))
      ) {
        suffix++
      }
      name = `${resource.name}${suffix}`
    }

    claimedKeys.add(moduleKeyOf(name))
    acc[id] = name === resource.name ? resource : { ...resource, name }
    return acc
  }, {})
}

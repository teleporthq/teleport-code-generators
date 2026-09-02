import { GenericUtils } from '../../src'

const { generatePageDependenciesPrefix, generatePageToRootPrefix, DEFAULT_PAGES_PATH } =
  GenericUtils

/**
 * Regression guard for the `pages/resources/[id].js` → `../fetch_content_items_detail`
 * build break: the page folder path is relative to the PAGES ROOT while the
 * target folder path is relative to the PROJECT ROOT, and resolving one against
 * the other cancelled the `resources` segment that only looked shared.
 */
describe('generatePageDependenciesPrefix', () => {
  it('reaches a root folder from a page at the pages root', () => {
    expect(generatePageDependenciesPrefix({ toPath: ['resources'], folderPath: [] })).toBe(
      '../resources/'
    )
  })

  it('reaches a root folder from a page in a subfolder', () => {
    expect(generatePageDependenciesPrefix({ toPath: ['resources'], folderPath: ['blog'] })).toBe(
      '../../resources/'
    )
  })

  it('does NOT collapse a page folder that is named after the target root folder', () => {
    expect(
      generatePageDependenciesPrefix({ toPath: ['resources'], folderPath: ['resources'] })
    ).toBe('../../resources/')
  })

  it('does not collapse deeper collisions either', () => {
    expect(
      generatePageDependenciesPrefix({
        toPath: ['utils', 'data-sources'],
        folderPath: ['utils', 'data-sources'],
      })
    ).toBe('../../../utils/data-sources/')
  })

  it('counts a multi-segment pages root', () => {
    expect(
      generatePageDependenciesPrefix({
        toPath: ['resources'],
        folderPath: ['resources'],
        pagesPath: ['src', 'pages'],
      })
    ).toBe('../../../resources/')
  })

  it('cancels a genuinely shared ancestor', () => {
    expect(
      generatePageDependenciesPrefix({
        toPath: ['src', 'resources'],
        folderPath: ['blog'],
        pagesPath: ['src', 'pages'],
      })
    ).toBe('../../resources/')
  })

  it('defaults to the Next pages root and to a page at that root', () => {
    expect(generatePageDependenciesPrefix({ toPath: ['components'] })).toBe('../components/')
    expect(DEFAULT_PAGES_PATH).toEqual(['pages'])
  })

  it('treats a missing folder path the same as an empty one', () => {
    expect(
      generatePageDependenciesPrefix({
        toPath: ['resources'],
        folderPath: undefined,
        pagesPath: undefined,
      })
    ).toBe('../resources/')
  })
})

describe('generatePageToRootPrefix', () => {
  it('matches the hand-rolled depth math it replaced', () => {
    expect(generatePageToRootPrefix({ folderPath: [] })).toBe('../')
    expect(generatePageToRootPrefix({ folderPath: ['admin'] })).toBe('../../')
    expect(generatePageToRootPrefix({ folderPath: ['admin', 'reports'] })).toBe('../../../')
    expect(generatePageToRootPrefix({})).toBe('../')
  })

  it('counts a multi-segment pages root', () => {
    expect(generatePageToRootPrefix({ folderPath: ['admin'], pagesPath: ['src', 'pages'] })).toBe(
      '../../../'
    )
  })
})

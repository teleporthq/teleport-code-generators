import { ScrollSceneRuntime } from '@teleporthq/teleport-shared'
import { activeChapterIndex } from '../src/widgets/scroll-scene-chapter-index'

describe('activeChapterIndex (generated runtime)', () => {
  const moments = [0, 0.3, 0.62, 0.9]

  it('is the last chapter whose moment the visitor has passed', () => {
    expect(activeChapterIndex(moments, 0)).toBe(0)
    expect(activeChapterIndex(moments, 0.29)).toBe(0)
    expect(activeChapterIndex(moments, 0.3)).toBe(1)
    expect(activeChapterIndex(moments, 0.75)).toBe(2)
    expect(activeChapterIndex(moments, 1)).toBe(3)
  })

  it('is -1 before the first chapter comes on stage', () => {
    expect(activeChapterIndex([0.1, 0.5], 0)).toBe(-1)
    expect(activeChapterIndex([], 0.5)).toBe(-1)
  })

  it('picks the latest moment passed even when moments are not in document order', () => {
    // chapter 1 has an author-set late snap point; 2 and 3 keep their even shares
    expect(activeChapterIndex([0.9, 0.33, 0.66], 0.5)).toBe(1)
    expect(activeChapterIndex([0.9, 0.33, 0.66], 0.7)).toBe(2)
    expect(activeChapterIndex([0.9, 0.33, 0.66], 0.95)).toBe(0)
  })

  it('tolerates float noise right at a moment', () => {
    expect(activeChapterIndex([0, 0.3], 0.3 - 1e-9)).toBe(1)
  })

  it('ships in the runtime as text derived from this file, under its own name', () => {
    const source = ScrollSceneRuntime.SCROLL_SCENE_HELPER_SOURCES.activeChapterIndex
    expect(source.startsWith('function activeChapterIndex(')).toBe(true)
    expect(ScrollSceneRuntime.engineSource()).toContain(source)
  })
})

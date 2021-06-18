import { resolveStyleSetDefinitions } from '../../src/resolvers/style-set-definitions'
import { staticNode } from '@teleporthq/teleport-uidl-builders'
import { UIDLStyleSetDefinition, UIDLStyleSetMediaCondition } from '@teleporthq/teleport-types'

describe('Resolves style-sheet', () => {
  const styleSheet: Record<string, UIDLStyleSetDefinition> = {
    primaryButton: {
      type: 'reusable-project-style-map' as const,
      conditions: [
        {
          type: 'screen-size' as const,
          content: {
            display: staticNode('block'),
          },
          meta: {
            maxWidth: 767,
          },
        },
        {
          type: 'screen-size' as const,
          content: {
            display: staticNode('none'),
          },
          meta: {
            maxWidth: 991,
          },
        },
      ],
      content: {
        display: staticNode('block'),
      },
    },
    secondaryButton: {
      type: 'reusable-project-style-map' as const,
      conditions: [
        {
          type: 'screen-size' as const,
          content: {
            display: staticNode('block'),
          },
          meta: {
            maxWidth: 767,
          },
        },
        {
          type: 'screen-size' as const,
          content: {
            display: staticNode('none'),
          },
          meta: {
            maxWidth: 991,
          },
        },
      ],
      content: {
        display: staticNode('block'),
      },
    },
  }

  it('Sorts the style-sheet in order', () => {
    const result = resolveStyleSetDefinitions(styleSheet)

    expect((result.primaryButton.conditions[0] as UIDLStyleSetMediaCondition).meta.maxWidth).toBe(
      991
    )
    expect((result.primaryButton.conditions[1] as UIDLStyleSetMediaCondition).meta.maxWidth).toBe(
      767
    )
    expect((result.secondaryButton.conditions[0] as UIDLStyleSetMediaCondition).meta.maxWidth).toBe(
      991
    )
    expect((result.secondaryButton.conditions[1] as UIDLStyleSetMediaCondition).meta.maxWidth).toBe(
      767
    )
  })

  it(`Resolver doesn't throw any error even if conditions are not passed`, () => {
    const styleSet = {
      primaryButton: {
        type: 'reusable-project-style-map' as const,
        conditions: [],
        content: {
          display: staticNode('block'),
        },
      },
    }
    const result = resolveStyleSetDefinitions(styleSet)

    expect(result).toEqual(styleSet)
  })
})

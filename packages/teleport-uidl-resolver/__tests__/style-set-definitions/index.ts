import { resolveStyleSetDefinitions } from '../../src/resolvers/style-set-definitions'
import { staticNode } from '@teleporthq/teleport-uidl-builders'
import { UIDLStyleSetDefinition, UIDLStyleSetMediaCondition } from '@teleporthq/teleport-types'

describe('Resolves style-sheet', () => {
  const styleSheet: Record<string, UIDLStyleSetDefinition> = {
    '5ed66ec0b98ab344e6299c7d': {
      id: '5ed66ec0b98ab344e6299c7d',
      name: 'primaryButton',
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
    '5ed66ec0b98ab344e6299c7c': {
      id: '5ed66ec0b98ab344e6299c7c',
      name: 'secondaryButton',
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

    expect(
      (result['5ed66ec0b98ab344e6299c7d'].conditions[0] as UIDLStyleSetMediaCondition).meta.maxWidth
    ).toBe(991)
    expect(
      (result['5ed66ec0b98ab344e6299c7d'].conditions[1] as UIDLStyleSetMediaCondition).meta.maxWidth
    ).toBe(767)
    expect(
      (result['5ed66ec0b98ab344e6299c7c'].conditions[0] as UIDLStyleSetMediaCondition).meta.maxWidth
    ).toBe(991)
    expect(
      (result['5ed66ec0b98ab344e6299c7c'].conditions[1] as UIDLStyleSetMediaCondition).meta.maxWidth
    ).toBe(767)
  })
})

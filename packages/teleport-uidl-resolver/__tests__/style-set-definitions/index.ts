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
    const result = resolveStyleSetDefinitions(styleSheet, {})

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

  it('Keeps valid CSS selector keys (incl. attribute selectors) and drops JS-fragment keys', () => {
    const styleSet: Record<string, UIDLStyleSetDefinition> = {
      'input-group': {
        type: 'reusable-project-style-map' as const,
        content: { display: staticNode('block') },
        className: 'input-group',
      },
      'input-group label': {
        type: 'reusable-project-style-map' as const,
        content: { display: staticNode('block') },
        className: 'input-group',
        subselectors: ' label',
      },
      'input-group input[type="number"]': {
        type: 'reusable-project-style-map' as const,
        content: { width: staticNode('100%') },
        className: 'input-group',
        subselectors: ' input[type="number"]',
      },
      'input-group input[type="range"]': {
        type: 'reusable-project-style-map' as const,
        content: { width: staticNode('100%') },
        className: 'input-group',
        subselectors: ' input[type="range"]',
      },
      // Combinators, pseudo-functions, universal and id selectors are valid CSS
      'card > span': {
        type: 'reusable-project-style-map' as const,
        content: { display: staticNode('block') },
        className: 'card',
        subselectors: ' > span',
      },
      'card + .card': {
        type: 'reusable-project-style-map' as const,
        content: { display: staticNode('block') },
        className: 'card',
        subselectors: ' + .card',
      },
      'list li:nth-child(2n+1)': {
        type: 'reusable-project-style-map' as const,
        content: { display: staticNode('block') },
        className: 'list',
        subselectors: ' li:nth-child(2n+1)',
      },
      'card:not(.active)': {
        type: 'reusable-project-style-map' as const,
        content: { display: staticNode('block') },
        className: 'card',
        subselectors: ':not(.active)',
      },
      '#main .card': {
        type: 'reusable-project-style-map' as const,
        content: { display: staticNode('block') },
        className: 'main',
        subselectors: ' .card',
      },
      // JS-fragment / invalid keys that must be dropped
      "'coin'": { type: 'reusable-project-style-map' as const, content: {} },
      '{{': { type: 'reusable-project-style-map' as const, content: {} },
      '||': { type: 'reusable-project-style-map' as const, content: {} },
      "t('coin')": { type: 'reusable-project-style-map' as const, content: {} },
      ['$' + '{expr}']: { type: 'reusable-project-style-map' as const, content: {} },
      'a && b': { type: 'reusable-project-style-map' as const, content: {} },
      '<div>': { type: 'reusable-project-style-map' as const, content: {} },
    }

    const result = resolveStyleSetDefinitions(styleSet, {})

    expect(Object.keys(result)).toEqual([
      'input-group',
      'input-group label',
      'input-group input[type="number"]',
      'input-group input[type="range"]',
      'card > span',
      'card + .card',
      'list li:nth-child(2n+1)',
      'card:not(.active)',
      '#main .card',
    ])
  })

  it(`Resolver doesn't throw any error even if conditions are not passed`, () => {
    const styleSet: Record<string, UIDLStyleSetDefinition> = {
      primaryButton: {
        type: 'reusable-project-style-map' as const,
        content: {
          display: staticNode('block'),
        },
      },
    }
    const result = resolveStyleSetDefinitions(styleSet, {})

    expect(result).toEqual(styleSet)
  })
})

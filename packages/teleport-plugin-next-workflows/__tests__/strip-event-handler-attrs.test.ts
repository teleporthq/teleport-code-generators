import { stripEventHandlerAttrs } from '../src/workflow-project-plugin'

// UIDL `attrs` hold data, never functions — an `on*`-named attr (the alerts
// fixture shipped `onClick: ""` on the Resolved pill) becomes a non-function
// JSX event prop that React invokes on click: `func.apply is not a function`.
// runBefore strips them so behavior stays on `events` / workflow triggers.

const element = (name: string, attrs: Record<string, unknown>, children: unknown[] = []) => ({
  type: 'element',
  content: { elementType: 'button', name, attrs, children },
})

const projectUidl = (): any => ({
  root: {
    name: 'Root',
    stateDefinitions: {},
    node: element('Page', { id: { type: 'static', content: 'page' } }, [
      element('ResolvedPill', {
        id: { type: 'static', content: 'status-resolved-btn' },
        'data-value': { type: 'static', content: 'Resolved' },
        onClick: { type: 'static', content: '' },
      }),
    ]),
  },
  components: {
    Card: {
      name: 'Card',
      node: element('Card', {
        onMouseEnter: { type: 'static', content: 'highlight()' },
        // lowercase second letter — NOT an event handler pattern, must survive
        onboarding: { type: 'static', content: 'step-1' },
      }),
    },
  },
})

describe('stripEventHandlerAttrs', () => {
  it('removes on[A-Z]* attrs from pages and components, keeps everything else', () => {
    const uidl = projectUidl()
    stripEventHandlerAttrs(uidl)

    const pill = uidl.root.node.content.children[0].content
    expect(pill.attrs.onClick).toBeUndefined()
    expect(pill.attrs.id.content).toBe('status-resolved-btn')
    expect(pill.attrs['data-value'].content).toBe('Resolved')

    const card = uidl.components.Card.node.content
    expect(card.attrs.onMouseEnter).toBeUndefined()
    expect(card.attrs.onboarding.content).toBe('step-1')
  })

  it('tolerates projects without components or attrs', () => {
    const uidl: any = {
      root: { name: 'Root', node: element('Bare', undefined as any) },
    }
    delete uidl.root.node.content.attrs
    expect(() => stripEventHandlerAttrs(uidl)).not.toThrow()
  })
})

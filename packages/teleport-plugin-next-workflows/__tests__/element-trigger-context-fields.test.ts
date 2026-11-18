// What an element trigger hands its workflow, on both ways a handler reaches
// the element: the React prop placed on it in the JSX, and the native listener
// attached by id when the element is not in the component's own JSX.
//
// A click delivers the bound element's `data-*` attributes under the names the
// static HTML export resolves (`data-tab-index` is `dataTabIndex`): a tab strip
// repeats one authored button per tab, and the attribute is the only thing
// that tells the buttons apart.

import type { UIDLWorkflow } from '@teleporthq/teleport-types'
import {
  generateElementHandler,
  generateUnmatchedElementFallback,
} from '../src/workflow-component-plugin'

const ELEMENT_ID = 'tab-button'
const SAFE_ID = 'wf_tabs'

const triggerInfo = (type: string, config: Record<string, unknown> = {}) => ({
  workflow: {
    id: 'wf-tabs',
    name: 'Switch tab',
    trigger: { nodeId: 'trigger', type, scope: 'element', config },
    nodes: [],
    edges: [],
  } as unknown as UIDLWorkflow,
  elementId: ELEMENT_ID,
  reactProp: 'onClick',
  triggerConfig: config,
})

type TriggerContext = Record<string, unknown>
type Listener = (event: FakeEvent) => void

interface FakeEvent {
  type: string
  target: FakeElement
  currentTarget: FakeElement | null
  clientX?: number
  preventDefault: () => void
  stopPropagation: () => void
}

/* The few things a handler touches on an element, behaving as a browser's do:
   `dataset` holds the `data-*` attributes under camelCased keys, an event
   bubbles to every ancestor with `currentTarget` set to the one being visited,
   and `currentTarget` is null once the dispatch is over. */
class FakeElement {
  public dataset: Record<string, string> = {}
  public parent: FakeElement | null = null
  public formFields: Record<string, string> = {}
  public value?: string
  private listeners: Record<string, Listener[]> = {}

  constructor(public id: string, dataAttributes: Record<string, string> = {}) {
    for (const name of Object.keys(dataAttributes)) {
      const key = name
        .replace(/^data-/, '')
        .replace(/-([a-z])/g, (_match, letter: string) => letter.toUpperCase())
      this.dataset[key] = dataAttributes[name]
    }
  }

  public append(child: FakeElement): FakeElement {
    child.parent = this
    return this
  }

  public addEventListener(type: string, listener: Listener): void {
    this.listeners[type] = [...(this.listeners[type] || []), listener]
  }

  public removeEventListener(): void {
    return undefined
  }

  public selfAndAncestors(): FakeElement[] {
    return [this as FakeElement].concat(this.parent ? this.parent.selfAndAncestors() : [])
  }

  public dispatch(type: string, init: { clientX?: number } = {}): void {
    const event: FakeEvent = {
      type,
      target: this,
      currentTarget: null,
      preventDefault: () => undefined,
      stopPropagation: () => undefined,
      ...init,
    }
    for (const visited of this.selfAndAncestors()) {
      event.currentTarget = visited
      ;(visited.listeners[type] || []).forEach((listener) => listener(event))
    }
    event.currentTarget = null
  }
}

class FakeFormData {
  constructor(private form: FakeElement) {}
  public forEach(visit: (value: string, key: string) => void): void {
    Object.keys(this.form.formFields).forEach((key) => visit(this.form.formFields[key], key))
  }
}

const page = (bound: FakeElement, child: FakeElement) => {
  bound.append(child)
  const byId: Record<string, FakeElement> = { [bound.id]: bound, [child.id]: child }
  const received: TriggerContext[] = []
  const execWf = (_config: unknown, triggerContext: TriggerContext) => {
    received.push(triggerContext)
    return Promise.resolve({})
  }
  const document = { getElementById: (id: string) => byId[id] || null }
  return { bound, child, document, received, execWf }
}

/** The React-prop handler, attached the way React attaches it: on the bound element. */
const attachJsxHandler = (
  site: ReturnType<typeof page>,
  type: string,
  domEvent: string,
  config: Record<string, unknown> = {}
) => {
  const source = generateElementHandler(triggerInfo(type, config))
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  const handler = new Function(
    '__execWf',
    `__wfConfig_${SAFE_ID}`,
    `__wfServerUrls_${SAFE_ID}`,
    'FormData',
    'window',
    `return ${source};`
  )(site.execWf, {}, {}, FakeFormData, {})
  site.bound.addEventListener(domEvent, handler)
  return source
}

const attachFallback = (
  site: ReturnType<typeof page>,
  type: string,
  _domEvent: string,
  config: Record<string, unknown> = {}
) => {
  const source = generateUnmatchedElementFallback(triggerInfo(type, config), SAFE_ID)
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  new Function(
    'document',
    'cleanups',
    '__execWf',
    `__wfConfig_${SAFE_ID}`,
    `__wfServerUrls_${SAFE_ID}`,
    'FormData',
    source
  )(site.document, [], site.execWf, {}, {}, FakeFormData)
  return source
}

const tabPage = (dataAttributes: Record<string, string>) =>
  page(new FakeElement(ELEMENT_ID, dataAttributes), new FakeElement('label'))

const TAB_ATTRIBUTES = {
  'data-tab-index': '2',
  'data-panel-group-name': 'plans',
  'data-element-id': 'shadow',
}

const clickLabel = (site: ReturnType<typeof page>) => site.child.dispatch('click', { clientX: 7 })

describe('a click trigger delivers the bound element data attributes', () => {
  const DATASET_MAPPING = `fields['data' + key.charAt(0).toUpperCase() + key.slice(1)]`

  it.each([
    ['the React prop', attachJsxHandler],
    ['the native-listener fallback', attachFallback],
  ])('through %s, read off the bound element when a child is clicked', (_name, attach) => {
    const site = tabPage(TAB_ATTRIBUTES)
    const source = attach(site, 'event-element-clicked', 'click')
    expect(source).toContain(DATASET_MAPPING)

    clickLabel(site)

    expect(site.received).toHaveLength(1)
    const [context] = site.received
    expect(context.dataTabIndex).toBe('2')
    expect(context.dataPanelGroupName).toBe('plans')
    expect(context.elementId).toBe(ELEMENT_ID)
    expect(context.clientX).toBe(7)
    expect(typeof context.timestamp).toBe('number')
  })

  it.each([
    ['the React prop', attachJsxHandler],
    ['the native-listener fallback', attachFallback],
  ])('through %s, an attribute never replaces a field of the trigger', (_name, attach) => {
    // `data-element-id` is delivered as `dataElementId`; the trigger's own
    // `elementId` is assigned after the attributes and stays what it was.
    const site = tabPage(TAB_ATTRIBUTES)
    attach(site, 'event-element-clicked', 'click')

    clickLabel(site)

    expect(site.received[0].dataElementId).toBe('shadow')
    expect(site.received[0].elementId).toBe(ELEMENT_ID)
  })

  it('a debounced click still reads the bound element, after the event is over', async () => {
    const site = tabPage(TAB_ATTRIBUTES)
    attachJsxHandler(site, 'event-element-clicked', 'click', { debounce: 5 })

    clickLabel(site)
    await new Promise((resolve) => setTimeout(resolve, 30))

    expect(site.received).toHaveLength(1)
    expect(site.received[0].dataTabIndex).toBe('2')
    expect(site.received[0].element).toBe(site.bound)
  })

  it('an element with no data attribute delivers the six trigger fields alone', () => {
    const site = tabPage({})
    attachJsxHandler(site, 'event-element-clicked', 'click')

    clickLabel(site)

    expect(Object.keys(site.received[0]).sort()).toEqual(
      ['clientX', 'clientY', 'element', 'elementId', 'timestamp', 'triggerElement'].sort()
    )
  })
})

describe('the native-listener fallback delivers what the React prop delivers', () => {
  it('a submitted form: every field at the top level, and under fields and formData', () => {
    const formPage = () => {
      const form = new FakeElement(ELEMENT_ID)
      form.formFields = { email: 'a@b.co', plan: 'pro' }
      return page(form, new FakeElement('email'))
    }

    const viaProp = formPage()
    attachJsxHandler(viaProp, 'event-form-submitted', 'submit')
    viaProp.bound.dispatch('submit')

    const viaFallback = formPage()
    const source = attachFallback(viaFallback, 'event-form-submitted', 'submit')
    viaFallback.bound.dispatch('submit')

    expect(source).toContain('Object.assign({}, formData, { fields: formData, formData: formData')
    const [context] = viaFallback.received
    expect(context.email).toBe('a@b.co')
    expect(context.plan).toBe('pro')
    expect(context.fields).toEqual({ email: 'a@b.co', plan: 'pro' })
    expect(context.formData).toEqual({ email: 'a@b.co', plan: 'pro' })
    expect(context.formId).toBe(ELEMENT_ID)
    expect(Object.keys(context).sort()).toEqual(Object.keys(viaProp.received[0]).sort())
  })

  it('an element event: the control that fired as target, the bound element as currentTarget', () => {
    const config = { eventType: 'change' }
    const radioPage = () => {
      const radio = new FakeElement('choice')
      radio.value = 'b'
      return page(new FakeElement(ELEMENT_ID), radio)
    }

    const viaProp = radioPage()
    attachJsxHandler(viaProp, 'event-element-event', 'change', config)
    viaProp.child.dispatch('change')

    const viaFallback = radioPage()
    const source = attachFallback(viaFallback, 'event-element-event', 'change', config)
    viaFallback.child.dispatch('change')

    expect(source).toContain(`target: event.target, currentTarget: __el_${SAFE_ID}`)
    const [context] = viaFallback.received
    expect(context.target).toBe(viaFallback.child)
    expect(context.currentTarget).toBe(viaFallback.bound)
    expect(context.value).toBe('b')
    expect(Object.keys(context).sort()).toEqual(Object.keys(viaProp.received[0]).sort())
  })
})

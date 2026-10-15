import { generalEmitCustomEvent } from '../src/nodes/general/general-emit-custom-event'

describe('Emit Custom Event', () => {
  /*
   * The trigger side listens on `workflow:custom:<name>` (trigger-generator). The
   * step used to dispatch the bare name, so "A Custom Event is Triggered" never
   * started a workflow.
   */
  it('dispatches on the channel the trigger listens to', () => {
    const handler = generalEmitCustomEvent.generateHandler()
    expect(handler).toContain("new CustomEvent('workflow:custom:' + eventName")
  })
})

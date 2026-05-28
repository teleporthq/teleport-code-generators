import { NodeHandlerGenerator, handlerToString } from '../types'

// Schema declares the output as `{ duration, timestamp }` (see
// node-context-schemas.json — labels "Duration (ms)" and "Completion Time").
// `duration` echoes the configured wait so downstream nodes can carry it
// forward; `timestamp` is the wall-clock epoch the timer resolved at, set
// AFTER the await so consumers see the post-delay moment, not the pre-delay
// scheduling time.
async function general_delay(config: any, context: Record<string, unknown>) {
  const duration = config.duration || 0

  await new Promise(function (resolve) {
    setTimeout(resolve, duration)
  })

  return { duration, timestamp: Date.now() }
}
export const generalDelay: NodeHandlerGenerator = {
  nodeType: 'general-delay',
  executionEnv: 'client',
  generateHandler(): string {
    return handlerToString(general_delay)
  },
}

import { resolveUIDLElement } from '@teleporthq/teleport-uidl-resolver'
import uidl from '../../../examples/uidl-samples/component.json'

const resolvedElement = resolveUIDLElement({ elementType: 'container' })
console.log(resolvedElement)

const run = async() => {
  import('./codegen').then(service => {
    generate(service.default)
  })
}

const generate = async(service) => {
  console.log("service", service)
  const result = await service.generateComponent(uidl)
    console.log(result)
}

run()
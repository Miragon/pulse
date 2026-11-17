const C7_IMAGES = /^(?:operaton\/operaton|cibseven\/cibseven)[:@]/
const C8_IMAGES = /^camunda\/camunda[:@]/

export const DEFAULT_ENGINE_IMAGE = "operaton/operaton:2.1.5"

export function camunda7ImageOf(image: string): boolean {
  if (C7_IMAGES.test(image)) {
    return true
  }
  if (C8_IMAGES.test(image)) {
    return false
  }
  throw new Error(
    `PULSE_ENGINE_IMAGE names ${image}, which is neither a Camunda 7 engine the suites start (operaton/operaton, cibseven/cibseven) nor a Camunda 8 cluster (camunda/camunda)`,
  )
}

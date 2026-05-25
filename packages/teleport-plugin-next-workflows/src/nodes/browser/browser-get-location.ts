import { NodeHandlerGenerator, handlerToString } from '../types'

async function browser_get_location(config: any) {
  if (!navigator.geolocation) {
    return { error: 'Geolocation is not supported by this browser' }
  }

  const options = {
    enableHighAccuracy: config.enableHighAccuracy || false,
    timeout: config.timeout || 10000,
    maximumAge: config.maximumAge || 0,
  }

  try {
    const position = await new Promise<GeolocationPosition>((resolve, reject) => {
      navigator.geolocation.getCurrentPosition(resolve, reject, options)
    })

    const coords = position.coords
    return {
      latitude: coords.latitude,
      longitude: coords.longitude,
      accuracy: coords.accuracy,
      altitude: coords.altitude,
      altitudeAccuracy: coords.altitudeAccuracy,
      heading: coords.heading,
      speed: coords.speed,
    }
  } catch (err: unknown) {
    return { error: (err as Error).message }
  }
}
export const browserGetLocation: NodeHandlerGenerator = {
  nodeType: 'browser-get-location',
  executionEnv: 'client',
  generateHandler(): string {
    return handlerToString(browser_get_location)
  },
}

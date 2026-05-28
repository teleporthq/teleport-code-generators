import { NodeHandlerGenerator, handlerToString } from '../types'

async function transform_geolocation(config: any, context: Record<string, unknown>) {
  const operation = config.operation || 'distance'
  const lat1 =
    config.lat1 !== undefined
      ? Number(config.lat1)
      : config.lat !== undefined
      ? Number(config.lat)
      : 0
  const lng1 =
    config.lng1 !== undefined
      ? Number(config.lng1)
      : config.lng !== undefined
      ? Number(config.lng)
      : 0
  const lat2 = config.lat2 !== undefined ? Number(config.lat2) : 0
  const lng2 = config.lng2 !== undefined ? Number(config.lng2) : 0
  const unit = config.unit || 'km'
  const format = config.format || 'decimal'
  const precision = config.precision !== undefined ? Number(config.precision) : 6
  const radius = config.radius !== undefined ? Number(config.radius) : 0
  let result: any

  function toRad(deg) {
    return (deg * Math.PI) / 180
  }

  function toDeg(rad) {
    return (rad * 180) / Math.PI
  }

  function haversineDistance(la1, lo1, la2, lo2) {
    const R = 6371
    const dLat = toRad(la2 - la1)
    const dLon = toRad(lo2 - lo1)
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(toRad(la1)) * Math.cos(toRad(la2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2)
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
    return R * c
  }

  function convertDistance(km, u) {
    switch (u) {
      case 'km':
        return km
      case 'mi':
        return km * 0.621371
      case 'm':
        return km * 1000
      case 'ft':
        return km * 3280.84
      case 'nm':
        return km * 0.539957
      default:
        return km
    }
  }

  try {
    switch (operation) {
      case 'current-location':
        if (typeof navigator !== 'undefined' && navigator.geolocation) {
          const position = (await new Promise(function (resolve, reject) {
            navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 10000 })
          })) as GeolocationPosition
          result = {
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
            accuracy: position.coords.accuracy,
          }
        } else {
          return { result: null, error: 'Geolocation not available' }
        }
        break
      case 'distance':
        const distKm = haversineDistance(lat1, lng1, lat2, lng2)
        const factor = Math.pow(10, precision)
        result = Math.round(convertDistance(distKm, unit) * factor) / factor
        break
      case 'geocode': {
        const address = config.address || ''
        if (!address) {
          return { result: null, error: 'Address is required for geocode operation' }
        }
        const apiProvider = config.apiProvider || 'nominatim'
        const apiKey = config.apiKey || ''
        let geoUrl

        if (apiProvider === 'google' && apiKey) {
          geoUrl =
            'https://maps.googleapis.com/maps/api/geocode/json?address=' +
            encodeURIComponent(address) +
            '&key=' +
            encodeURIComponent(apiKey)
        } else if (apiProvider === 'mapbox' && apiKey) {
          geoUrl =
            'https://api.mapbox.com/geocoding/v5/mapbox.places/' +
            encodeURIComponent(address) +
            '.json?access_token=' +
            encodeURIComponent(apiKey)
        } else {
          geoUrl =
            'https://nominatim.openstreetmap.org/search?q=' +
            encodeURIComponent(address) +
            '&format=json&limit=1'
        }

        const geoResponse = await fetch(geoUrl, {
          headers: { 'User-Agent': 'TeleportWorkflow/1.0' },
        })
        if (!geoResponse.ok) {
          return { result: null, error: 'Geocoding request failed: HTTP ' + geoResponse.status }
        }
        const geoData = await geoResponse.json()

        if (apiProvider === 'google' && apiKey) {
          if (geoData.status !== 'OK' || !geoData.results || geoData.results.length === 0) {
            return { result: null, error: 'No results found for address: ' + address }
          }
          const gLoc = geoData.results[0].geometry.location
          result = {
            latitude: gLoc.lat,
            longitude: gLoc.lng,
            formattedAddress: geoData.results[0].formatted_address,
            placeId: geoData.results[0].place_id,
          }
        } else if (apiProvider === 'mapbox' && apiKey) {
          if (!geoData.features || geoData.features.length === 0) {
            return { result: null, error: 'No results found for address: ' + address }
          }
          const mbCoords = geoData.features[0].center
          result = {
            latitude: mbCoords[1],
            longitude: mbCoords[0],
            formattedAddress: geoData.features[0].place_name,
          }
        } else {
          if (!geoData || !Array.isArray(geoData) || geoData.length === 0) {
            return { result: null, error: 'No results found for address: ' + address }
          }
          result = {
            latitude: parseFloat(geoData[0].lat),
            longitude: parseFloat(geoData[0].lon),
            formattedAddress: geoData[0].display_name,
          }
        }
        break
      }
      case 'reverse-geocode': {
        const revApiProvider = config.apiProvider || 'nominatim'
        const revApiKey = config.apiKey || ''
        let revUrl

        if (revApiProvider === 'google' && revApiKey) {
          revUrl =
            'https://maps.googleapis.com/maps/api/geocode/json?latlng=' +
            lat1 +
            ',' +
            lng1 +
            '&key=' +
            encodeURIComponent(revApiKey)
        } else if (revApiProvider === 'mapbox' && revApiKey) {
          revUrl =
            'https://api.mapbox.com/geocoding/v5/mapbox.places/' +
            lng1 +
            ',' +
            lat1 +
            '.json?access_token=' +
            encodeURIComponent(revApiKey)
        } else {
          revUrl =
            'https://nominatim.openstreetmap.org/reverse?lat=' +
            lat1 +
            '&lon=' +
            lng1 +
            '&format=json'
        }

        const revResponse = await fetch(revUrl, {
          headers: { 'User-Agent': 'TeleportWorkflow/1.0' },
        })
        if (!revResponse.ok) {
          return {
            result: null,
            error: 'Reverse geocoding request failed: HTTP ' + revResponse.status,
          }
        }
        const revData = await revResponse.json()

        if (revApiProvider === 'google' && revApiKey) {
          if (revData.status !== 'OK' || !revData.results || revData.results.length === 0) {
            return {
              result: null,
              error: 'No results found for coordinates: ' + lat1 + ', ' + lng1,
            }
          }
          result = {
            address: revData.results[0].formatted_address,
            components: revData.results[0].address_components,
            placeId: revData.results[0].place_id,
          }
        } else if (revApiProvider === 'mapbox' && revApiKey) {
          if (!revData.features || revData.features.length === 0) {
            return {
              result: null,
              error: 'No results found for coordinates: ' + lat1 + ', ' + lng1,
            }
          }
          result = {
            address: revData.features[0].place_name,
            components: revData.features[0].context || [],
          }
        } else {
          if (revData.error) {
            return { result: null, error: 'Reverse geocoding failed: ' + revData.error }
          }
          const addr = revData.address || {}
          result = {
            address: revData.display_name,
            components: {
              house_number: addr.house_number || null,
              road: addr.road || null,
              city: addr.city || addr.town || addr.village || null,
              state: addr.state || null,
              country: addr.country || null,
              postcode: addr.postcode || null,
              country_code: addr.country_code || null,
            },
          }
        }
        break
      }
      case 'is-within-radius':
        const withinKm = haversineDistance(lat1, lng1, lat2, lng2)
        const radiusInKm = unit === 'mi' ? radius / 0.621371 : unit === 'm' ? radius / 1000 : radius
        result = withinKm <= radiusInKm
        break
      case 'get-timezone': {
        const tzApiKey = config.apiKey || ''

        if (tzApiKey) {
          const timestamp = Math.floor(Date.now() / 1000)
          const tzUrl =
            'https://maps.googleapis.com/maps/api/timezone/json?location=' +
            lat1 +
            ',' +
            lng1 +
            '&timestamp=' +
            timestamp +
            '&key=' +
            encodeURIComponent(tzApiKey)

          const tzResponse = await fetch(tzUrl)
          if (!tzResponse.ok) {
            return { result: null, error: 'Timezone request failed: HTTP ' + tzResponse.status }
          }
          const tzData = await tzResponse.json()

          if (tzData.status !== 'OK') {
            return {
              result: null,
              error: 'Timezone lookup failed: ' + (tzData.errorMessage || tzData.status),
            }
          }

          result = {
            timeZoneId: tzData.timeZoneId,
            timeZoneName: tzData.timeZoneName,
            rawOffset: tzData.rawOffset,
            dstOffset: tzData.dstOffset,
            totalOffsetSeconds: tzData.rawOffset + tzData.dstOffset,
            totalOffsetHours: (tzData.rawOffset + tzData.dstOffset) / 3600,
          }
        } else {
          const offsetHours = Math.round(lng1 / 15)
          const offsetSign = offsetHours >= 0 ? '+' : ''
          result = {
            timeZoneId: 'Etc/GMT' + (offsetHours <= 0 ? '+' : '-') + Math.abs(offsetHours),
            timeZoneName: 'UTC' + offsetSign + offsetHours,
            rawOffset: offsetHours * 3600,
            dstOffset: 0,
            totalOffsetSeconds: offsetHours * 3600,
            totalOffsetHours: offsetHours,
            approximate: true,
          }
        }
        break
      }
      case 'bearing':
        const dLon = toRad(lng2 - lng1)
        const y = Math.sin(dLon) * Math.cos(toRad(lat2))
        const x =
          Math.cos(toRad(lat1)) * Math.sin(toRad(lat2)) -
          Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(dLon)
        const bearing = toDeg(Math.atan2(y, x))
        result = (bearing + 360) % 360
        const bFactor = Math.pow(10, precision)
        result = Math.round(result * bFactor) / bFactor
        break
      case 'midpoint':
        const dLonM = toRad(lng2 - lng1)
        const lat1Rad = toRad(lat1)
        const lat2Rad = toRad(lat2)
        const lng1Rad = toRad(lng1)
        const bx = Math.cos(lat2Rad) * Math.cos(dLonM)
        const by = Math.cos(lat2Rad) * Math.sin(dLonM)
        const midLat = Math.atan2(
          Math.sin(lat1Rad) + Math.sin(lat2Rad),
          Math.sqrt((Math.cos(lat1Rad) + bx) * (Math.cos(lat1Rad) + bx) + by * by)
        )
        const midLng = lng1Rad + Math.atan2(by, Math.cos(lat1Rad) + bx)
        const mFactor = Math.pow(10, precision)
        result = {
          latitude: Math.round(toDeg(midLat) * mFactor) / mFactor,
          longitude: Math.round(toDeg(midLng) * mFactor) / mFactor,
        }
        break
      case 'validate':
        result = lat1 >= -90 && lat1 <= 90 && lng1 >= -180 && lng1 <= 180
        break
      case 'format':
        if (format === 'dms') {
          const toDMS = function (deg: number, pos: string, neg: string) {
            const abs = Math.abs(deg)
            const d = Math.floor(abs)
            const m = Math.floor((abs - d) * 60)
            const s = Math.round(((abs - d) * 60 - m) * 60 * 100) / 100
            return d + '° ' + m + "' " + s + '" ' + (deg >= 0 ? pos : neg)
          }
          result = {
            latitude: toDMS(lat1, 'N', 'S'),
            longitude: toDMS(lng1, 'E', 'W'),
          }
        } else {
          const fFactor = Math.pow(10, precision)
          result = {
            latitude: Math.round(lat1 * fFactor) / fFactor,
            longitude: Math.round(lng1 * fFactor) / fFactor,
          }
        }
        break
      default:
        return { result: null, error: 'Unknown operation: ' + operation }
    }

    return { result }
  } catch (err: unknown) {
    return { result: null, error: (err as Error).message }
  }
}
export const transformGeolocation: NodeHandlerGenerator = {
  nodeType: 'transform-geolocation',
  executionEnv: 'universal',
  generateHandler(): string {
    return handlerToString(transform_geolocation)
  },
}

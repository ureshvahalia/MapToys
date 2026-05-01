import turfDistance from '@turf/distance'
import { point } from '@turf/helpers'

export interface Airport {
  iata: string
  name: string
  lngLat: [number, number]
}

export interface NearestAirport {
  airport: Airport
  distKm: number  // distance from origin (great-circle), always stored in km
}

let cache: Airport[] | null = null

export async function loadAirports(): Promise<Airport[]> {
  if (cache) return cache
  const res = await fetch(`${import.meta.env.BASE_URL}data/airports.json`)
  cache = await res.json()
  return cache!
}

export function findNearestAirport(antipodeLngLat: [number, number], originLngLat: [number, number], airports: Airport[]): NearestAirport {
  let nearest = airports[0]
  let minDistToAntipode = Infinity

  for (const ap of airports) {
    const d = turfDistance(point(antipodeLngLat), point(ap.lngLat), { units: 'kilometers' })
    if (d < minDistToAntipode) {
      minDistToAntipode = d
      nearest = ap
    }
  }

  const distKm = turfDistance(point(originLngLat), point(nearest.lngLat), { units: 'kilometers' })
  return { airport: nearest, distKm }
}

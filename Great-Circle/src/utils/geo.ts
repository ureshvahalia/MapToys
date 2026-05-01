import greatCircle from '@turf/great-circle'
import turfDistance from '@turf/distance'
import { point, featureCollection } from '@turf/helpers'
import type { FeatureCollection } from 'geojson'

export function calcAntipode([lng, lat]: [number, number]): [number, number] {
  return [lng >= 0 ? lng - 180 : lng + 180, -lat]
}

export function buildRoute(coords: [number, number][]): FeatureCollection {
  const features: any[] = []
  for (let i = 0; i < coords.length - 1; i++) {
    const [a, b] = [coords[i], coords[i + 1]]
    const dist = Math.abs(a[0] - b[0])
    const isNearlyAntipodal = dist > 179 && Math.abs(a[1] + b[1]) < 1
    if (isNearlyAntipodal) continue
    try {
      features.push(greatCircle(point(a), point(b), { npoints: 100 }))
    } catch {
      // skip degenerate segment
    }
  }
  return featureCollection(features)
}

export function calcDistances(coords: [number, number][], unit: 'km' | 'miles'): number[] {
  const turfUnit = unit === 'km' ? 'kilometers' : 'miles'
  return coords.slice(0, -1).map((c, i) =>
    turfDistance(point(c), point(coords[i + 1]), { units: turfUnit })
  )
}

export function computeGlobeZoom(containerWidth: number, containerHeight: number): number {
  // Fills ~90% of the smaller viewport dimension with the globe sphere.
  // Formula: globe radius in px = 512 * 2^zoom / (2π), solve for zoom.
  const minDim = Math.min(containerWidth, containerHeight)
  const zoom = Math.log2((0.9 * minDim * Math.PI) / 512)
  return Math.max(1, Math.min(3.5, zoom))
}

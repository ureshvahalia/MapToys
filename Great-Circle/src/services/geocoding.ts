export interface GeocodingResult {
  label: string
  lngLat: [number, number]
}

export async function searchPlaces(query: string): Promise<GeocodingResult[]> {
  if (query.trim().length < 2) return []
  const url = new URL('https://nominatim.openstreetmap.org/search')
  url.searchParams.set('q', query)
  url.searchParams.set('format', 'json')
  url.searchParams.set('limit', '5')
  try {
    const res = await fetch(url.toString(), { headers: { 'Accept-Language': 'en' } })
    const data: any[] = await res.json()
    return data.map(item => ({
      label: item.display_name as string,
      lngLat: [parseFloat(item.lon), parseFloat(item.lat)] as [number, number],
    }))
  } catch {
    return []
  }
}

export async function reverseGeocode(lngLat: [number, number]): Promise<string> {
  const url = new URL('https://nominatim.openstreetmap.org/reverse')
  url.searchParams.set('lat', String(lngLat[1]))
  url.searchParams.set('lon', String(lngLat[0]))
  url.searchParams.set('format', 'json')
  try {
    const res = await fetch(url.toString(), { headers: { 'Accept-Language': 'en' } })
    const data = await res.json()
    return (data.display_name as string) || coordLabel(lngLat)
  } catch {
    return coordLabel(lngLat)
  }
}

function coordLabel([lng, lat]: [number, number]): string {
  return `${Math.abs(lat).toFixed(4)}°${lat >= 0 ? 'N' : 'S'}, ${Math.abs(lng).toFixed(4)}°${lng >= 0 ? 'E' : 'W'}`
}

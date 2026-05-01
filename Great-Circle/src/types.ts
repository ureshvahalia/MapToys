export interface Location {
  id: string
  label: string
  lngLat: [number, number]
}

export interface WaypointSlot {
  slotId: string
  location: Location | null
}

export type Unit = 'km' | 'miles'

export type FocusedField = 'origin' | 'destination' | number | null

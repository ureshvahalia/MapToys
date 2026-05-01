import { useEffect, useRef, useState, useCallback } from 'react'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import LocationPanel from './components/LocationPanel'
import { reverseGeocode } from './services/geocoding'
import { calcAntipode, buildRoute, calcDistances, computeGlobeZoom } from './utils/geo'
import { loadAirports, findNearestAirport } from './utils/airports'
import type { Airport, NearestAirport } from './utils/airports'
import type { Location, WaypointSlot, Unit, FocusedField } from './types'
import './App.css'

const MAP_STYLE = 'https://tiles.openfreemap.org/styles/liberty'

export default function App() {
  // --- map refs ---
  const mainContainer = useRef<HTMLDivElement>(null)
  const antipodeContainer = useRef<HTMLDivElement>(null)
  const mainMap = useRef<maplibregl.Map | null>(null)
  const antipodeMap = useRef<maplibregl.Map | null>(null)
  const markers = useRef<Map<string, maplibregl.Marker>>(new Map())

  // --- app state ---
  const [origin, setOrigin] = useState<Location | null>(null)
  const [destination, setDestination] = useState<Location | null>(null)
  const [waypointSlots, setWaypointSlots] = useState<WaypointSlot[]>([])
  const [unit, setUnit] = useState<Unit>(() => (localStorage.getItem('unit') as Unit) || 'km')
  const [isGlobe, setIsGlobe] = useState(true)
  const [infoDismissed, setInfoDismissed] = useState(() => localStorage.getItem('info-dismissed') === '1')
  const [distances, setDistances] = useState<number[]>([])
  const [airports, setAirports] = useState<Airport[]>([])
  const [nearestAirport, setNearestAirport] = useState<NearestAirport | null>(null)

  // Ref mirror for click handler (avoids stale closures)
  const focusedField = useRef<FocusedField>(null)
  const originRef = useRef(origin)
  const destinationRef = useRef(destination)
  const waypointSlotsRef = useRef(waypointSlots)
  useEffect(() => { originRef.current = origin }, [origin])
  useEffect(() => { destinationRef.current = destination }, [destination])
  useEffect(() => { waypointSlotsRef.current = waypointSlots }, [waypointSlots])

  // --- load airports once ---
  useEffect(() => {
    loadAirports().then(setAirports).catch(() => {})
  }, [])

  // --- compute nearest airport to antipode whenever origin/destination changes ---
  useEffect(() => {
    if (!origin || destination || airports.length === 0) {
      setNearestAirport(null)
      return
    }
    const ap = calcAntipode(origin.lngLat)
    setNearestAirport(findNearestAirport(ap, origin.lngLat, airports))
  }, [origin, destination, airports])

  // --- map initialisation ---
  useEffect(() => {
    if (mainMap.current || !mainContainer.current || !antipodeContainer.current) return

    mainMap.current = new maplibregl.Map({
      container: mainContainer.current,
      style: MAP_STYLE,
      center: [0, 20],
      zoom: 1.5,
    })

    antipodeMap.current = new maplibregl.Map({
      container: antipodeContainer.current,
      style: MAP_STYLE,
      center: [180, -20],
      zoom: 1.5,
      interactive: false,
    })

    mainMap.current.on('load', () => {
      const m = mainMap.current!
      m.setProjection({ type: 'globe' })
      const { clientWidth: w, clientHeight: h } = mainContainer.current!
      m.setZoom(computeGlobeZoom(w, h))
      m.addSource('route', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
      m.addLayer({
        id: 'route-line',
        type: 'line',
        source: 'route',
        paint: { 'line-color': '#3b82f6', 'line-width': 2.5, 'line-dasharray': [1, 0] },
      })
    })

    antipodeMap.current.on('load', () => {
      antipodeMap.current!.setProjection({ type: 'globe' })
    })

    mainMap.current.on('move', () => {
      const m = mainMap.current!
      const ap = antipodeMap.current!
      const c = m.getCenter()
      ap.jumpTo({
        center: { lng: c.lng >= 0 ? c.lng - 180 : c.lng + 180, lat: -c.lat },
        zoom: m.getZoom(),
        bearing: m.getBearing(),
        pitch: m.getPitch(),
      })
    })

    mainMap.current.on('click', async (e) => {
      const lngLat: [number, number] = [e.lngLat.lng, e.lngLat.lat]
      const label = await reverseGeocode(lngLat)
      const loc: Location = { id: crypto.randomUUID(), label, lngLat }
      const field = focusedField.current

      if (field === 'origin') {
        setOrigin(loc)
      } else if (field === 'destination') {
        setDestination(loc)
      } else if (typeof field === 'number') {
        setWaypointSlots(prev =>
          prev.map((s, i) => i === field ? { ...s, location: loc } : s)
        )
      } else {
        if (!originRef.current) setOrigin(loc)
        else if (!destinationRef.current) setDestination(loc)
        else setWaypointSlots(prev => [...prev, { slotId: crypto.randomUUID(), location: loc }])
      }
    })

    return () => {
      mainMap.current?.remove(); mainMap.current = null
      antipodeMap.current?.remove(); antipodeMap.current = null
    }
  }, [])

  // --- update markers ---
  useEffect(() => {
    markers.current.forEach(m => m.remove())
    markers.current.clear()
    const m = mainMap.current
    if (!m) return

    function addMarker(key: string, lngLat: [number, number], color: string, draggable = true) {
      const marker = new maplibregl.Marker({ color, draggable })
        .setLngLat(lngLat)
        .addTo(m!)
      if (draggable) {
        marker.on('dragend', async () => {
          const pos = marker.getLngLat()
          const ll: [number, number] = [pos.lng, pos.lat]
          const label = await reverseGeocode(ll)
          const loc: Location = { id: crypto.randomUUID(), label, lngLat: ll }
          if (key === 'origin') setOrigin(loc)
          else if (key === 'destination') setDestination(loc)
          else {
            const idx = parseInt(key.replace('waypoint-', ''))
            setWaypointSlots(prev =>
              prev.map((s, i) => i === idx ? { ...s, location: loc } : s)
            )
          }
        })
      }
      markers.current.set(key, marker)
      return marker
    }

    if (origin) addMarker('origin', origin.lngLat, '#3b82f6')

    waypointSlots.forEach((slot, i) => {
      if (slot.location) addMarker(`waypoint-${i}`, slot.location.lngLat, '#8b5cf6')
    })

    if (destination) {
      addMarker('destination', destination.lngLat, '#ef4444')
    } else if (origin) {
      addMarker('antipode', calcAntipode(origin.lngLat), '#ef4444', false)

      if (nearestAirport) {
        const ap = nearestAirport.airport
        const el = document.createElement('div')
        el.className = 'airport-marker-pin'
        el.title = `${ap.name} (${ap.iata}) — click to set as destination`
        el.addEventListener('click', (e) => {
          e.stopPropagation()
          setDestination({
            id: crypto.randomUUID(),
            label: `${ap.name} (${ap.iata})`,
            lngLat: ap.lngLat,
          })
        })
        const airportMarker = new maplibregl.Marker({ element: el })
          .setLngLat(ap.lngLat)
          .addTo(m!)
        markers.current.set('airport', airportMarker)
      }
    }
  }, [origin, destination, waypointSlots, nearestAirport])

  // --- update route layer ---
  useEffect(() => {
    const m = mainMap.current
    if (!m || !m.isStyleLoaded()) return

    const activeLocs = [origin, ...waypointSlots.map(s => s.location), destination]
      .filter((l): l is Location => l !== null)

    const src = m.getSource('route') as maplibregl.GeoJSONSource | undefined
    if (!src) return

    if (activeLocs.length >= 2) {
      const coords = activeLocs.map(l => l.lngLat)
      src.setData(buildRoute(coords))
      setDistances(calcDistances(coords, unit))
    } else {
      src.setData({ type: 'FeatureCollection', features: [] })
      setDistances([])
    }
  }, [origin, destination, waypointSlots, unit])

  // --- antipodal overlay always visible ---
  useEffect(() => {
    if (antipodeContainer.current) antipodeContainer.current.style.display = 'block'
  }, [])

  const handleFocusField = useCallback((field: FocusedField) => {
    focusedField.current = field
  }, [])

  function handleUnitChange(u: Unit) {
    setUnit(u)
    localStorage.setItem('unit', u)
  }

  function handleToggleProjection() {
    const next = isGlobe ? 'mercator' : 'globe'
    mainMap.current?.setProjection({ type: next })
    antipodeMap.current?.setProjection({ type: next })
    setIsGlobe(!isGlobe)
  }

  function handleClearAll() {
    setOrigin(null)
    setDestination(null)
    setWaypointSlots([])
    setDistances([])
    focusedField.current = null
  }

  return (
    <div id="app">
      <div id="map-wrapper">
        <div ref={mainContainer} id="map-main" />
        <div ref={antipodeContainer} id="map-antipodal" />
      </div>
      <LocationPanel
        origin={origin}
        destination={destination}
        waypointSlots={waypointSlots}
        unit={unit}
        distances={distances}
        isGlobe={isGlobe}
        nearestAirport={nearestAirport}
        onOriginSelect={setOrigin}
        onOriginClear={() => setOrigin(null)}
        onDestinationSelect={setDestination}
        onDestinationClear={() => setDestination(null)}
        onWaypointAdd={() =>
          setWaypointSlots(prev => [...prev, { slotId: crypto.randomUUID(), location: null }])
        }
        onWaypointUpdate={(slotId, loc) =>
          setWaypointSlots(prev => prev.map(s => s.slotId === slotId ? { ...s, location: loc } : s))
        }
        onWaypointRemove={slotId =>
          setWaypointSlots(prev => prev.filter(s => s.slotId !== slotId))
        }
        onWaypointsReorder={setWaypointSlots}
        onUnitChange={handleUnitChange}
        onClearAll={handleClearAll}
        onFocusField={handleFocusField}
        onToggleProjection={handleToggleProjection}
        onAirportSelect={setDestination}
      />
      {!infoDismissed && (
        <div id="info-box">
          <button
            id="info-box-close"
            onClick={() => { setInfoDismissed(true); localStorage.setItem('info-dismissed', '1') }}
            title="Dismiss"
          >✕</button>
          <p>
            Explore the globe and find the exact point on the opposite side of the Earth
            from any location — its <em>antipode</em>. Search by city, address, or landmark,
            or click anywhere on the map. Switch between 3D globe and flat map views, and see
            a ghosted overlay of the far side of the Earth through the globe. Plan multi-stop
            great-circle routes — the shortest path a plane or bird would fly — with distances
            shown per segment and in total.
          </p>
        </div>
      )}
    </div>
  )
}

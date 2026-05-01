import { useState } from 'react'
import {
  DndContext, closestCenter, PointerSensor, useSensor, useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext, verticalListSortingStrategy, useSortable, arrayMove,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import LocationInput from './LocationInput'
import type { Location, WaypointSlot, Unit, FocusedField } from '../types'
import type { NearestAirport } from '../utils/airports'
import './LocationPanel.css'

interface Props {
  origin: Location | null
  destination: Location | null
  waypointSlots: WaypointSlot[]
  unit: Unit
  distances: number[]
  isGlobe: boolean
  nearestAirport: NearestAirport | null
  onOriginSelect: (loc: Location) => void
  onOriginClear: () => void
  onDestinationSelect: (loc: Location) => void
  onDestinationClear: () => void
  onWaypointAdd: () => void
  onWaypointUpdate: (slotId: string, loc: Location | null) => void
  onWaypointRemove: (slotId: string) => void
  onWaypointsReorder: (newSlots: WaypointSlot[]) => void
  onUnitChange: (unit: Unit) => void
  onClearAll: () => void
  onFocusField: (field: FocusedField) => void
  onToggleProjection: () => void
  onAirportSelect: (loc: Location) => void
}

interface SortableItemProps {
  slot: WaypointSlot
  index: number
  onUpdate: (loc: Location | null) => void
  onRemove: () => void
  onFocus: () => void
}

function SortableWaypointItem({ slot, index, onUpdate, onRemove, onFocus }: SortableItemProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: slot.slotId,
  })
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  }

  return (
    <div ref={setNodeRef} style={style} className="waypoint-row">
      <button
        className="drag-handle"
        {...attributes}
        {...listeners}
        title="Drag to reorder"
        tabIndex={-1}
      >
        ⠿
      </button>
      <div className="waypoint-input">
        <LocationInput
          label={`Stop ${index + 1}`}
          icon="◆"
          location={slot.location}
          onSelect={onUpdate}
          onClear={() => onUpdate(null)}
          onFocus={onFocus}
          placeholder="Search for a stop…"
        />
      </div>
      <button className="remove-btn" onClick={onRemove} title="Remove stop">✕</button>
    </div>
  )
}

export default function LocationPanel({
  origin, destination, waypointSlots, unit, distances, isGlobe, nearestAirport,
  onOriginSelect, onOriginClear, onDestinationSelect, onDestinationClear,
  onWaypointAdd, onWaypointUpdate, onWaypointRemove, onWaypointsReorder,
  onUnitChange, onClearAll, onFocusField, onToggleProjection, onAirportSelect,
}: Props) {
  const [collapsed, setCollapsed] = useState(() => window.innerWidth < 640)

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } })
  )

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event
    if (!over || active.id === over.id) return
    const oldIdx = waypointSlots.findIndex(s => s.slotId === active.id)
    const newIdx = waypointSlots.findIndex(s => s.slotId === over.id)
    if (oldIdx !== -1 && newIdx !== -1) {
      onWaypointsReorder(arrayMove(waypointSlots, oldIdx, newIdx))
    }
  }

  const allLocs = [origin, ...waypointSlots.map(s => s.location), destination].filter(Boolean)
  const totalDist = distances.reduce((s, d) => s + d, 0)

  return (
    <div id="panel" className={collapsed ? 'panel--collapsed' : ''}>
      <div className="panel-header">
        <span className="panel-title">Route Planner</span>
        <button className="collapse-btn" onClick={() => setCollapsed(c => !c)} title={collapsed ? 'Expand' : 'Collapse'}>
          {collapsed ? '▶' : '◀'}
        </button>
      </div>

      {!collapsed && (
        <div className="panel-body">
          <LocationInput
            label="Origin"
            icon="●"
            location={origin}
            onSelect={onOriginSelect}
            onClear={onOriginClear}
            onFocus={() => onFocusField('origin')}
            placeholder="Search for origin…"
          />

          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <SortableContext items={waypointSlots.map(s => s.slotId)} strategy={verticalListSortingStrategy}>
              {waypointSlots.map((slot, i) => (
                <SortableWaypointItem
                  key={slot.slotId}
                  slot={slot}
                  index={i}
                  onUpdate={loc => onWaypointUpdate(slot.slotId, loc)}
                  onRemove={() => onWaypointRemove(slot.slotId)}
                  onFocus={() => onFocusField(i)}
                />
              ))}
            </SortableContext>
          </DndContext>

          <button className="add-stop-btn" onClick={onWaypointAdd}>+ Add stop</button>

          <LocationInput
            label="Destination"
            icon="▲"
            location={destination}
            onSelect={onDestinationSelect}
            onClear={onDestinationClear}
            onFocus={() => onFocusField('destination')}
            placeholder="Search for destination…"
          />

          {origin && !destination && nearestAirport && (
            <div className="airport-card">
              <div className="airport-card__title">Farthest airport from origin</div>
              <button
                className="airport-card__btn"
                onClick={() => onAirportSelect({
                  id: crypto.randomUUID(),
                  label: `${nearestAirport.airport.name} (${nearestAirport.airport.iata})`,
                  lngLat: nearestAirport.airport.lngLat,
                })}
              >
                <span className="airport-card__iata">{nearestAirport.airport.iata}</span>
                <span className="airport-card__name">{nearestAirport.airport.name}</span>
              </button>
              <div className="airport-card__dist">
                {formatDistKm(nearestAirport.distKm, unit)} from origin · tap to set as destination
              </div>
            </div>
          )}

          {allLocs.length >= 2 && distances.length > 0 && (
            <div className="route-info">
              <div className="route-info__title">Distances</div>
              {distances.map((d, i) => (
                <div key={i} className="route-info__row">
                  <span>Seg {i + 1}</span>
                  <span>{formatDist(d, unit)}</span>
                </div>
              ))}
              {distances.length > 1 && (
                <div className="route-info__row route-info__total">
                  <span>Total</span>
                  <span>{formatDist(totalDist, unit)}</span>
                </div>
              )}
            </div>
          )}

          <div className="panel-divider" />

          <div className="settings">
            <span className="settings__label">Units</span>
            <label className="settings__option">
              <input type="radio" name="unit" value="km" checked={unit === 'km'} onChange={() => onUnitChange('km')} />
              km
            </label>
            <label className="settings__option">
              <input type="radio" name="unit" value="miles" checked={unit === 'miles'} onChange={() => onUnitChange('miles')} />
              miles
            </label>
          </div>

          <div className="panel-controls">
            <button className="ctrl-btn" onClick={onToggleProjection}>
              {isGlobe ? 'Flat view' : 'Globe view'}
            </button>
            <button className="ctrl-btn ctrl-btn--danger" onClick={onClearAll}>
              Clear all
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function formatDist(d: number, unit: Unit): string {
  return unit === 'km'
    ? `${Math.round(d).toLocaleString()} km`
    : `${Math.round(d).toLocaleString()} mi`
}

function formatDistKm(km: number, unit: Unit): string {
  return formatDist(unit === 'km' ? km : km * 0.621371, unit)
}

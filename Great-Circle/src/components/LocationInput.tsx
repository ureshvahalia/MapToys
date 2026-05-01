import { useState, useRef, useEffect, useCallback } from 'react'
import { searchPlaces } from '../services/geocoding'
import type { GeocodingResult } from '../services/geocoding'
import type { Location } from '../types'
import './LocationInput.css'

interface Props {
  label: string
  icon: string
  location: Location | null
  onSelect: (loc: Location) => void
  onClear: () => void
  onFocus: () => void
  placeholder?: string
}

export default function LocationInput({
  label, icon, location, onSelect, onClear, onFocus, placeholder,
}: Props) {
  const [query, setQuery] = useState(location?.label ?? '')
  const [results, setResults] = useState<GeocodingResult[]>([])
  const [open, setOpen] = useState(false)
  const [activeIdx, setActiveIdx] = useState(-1)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setQuery(location?.label ?? '')
  }, [location?.label])

  const runSearch = useCallback(async (q: string) => {
    const r = await searchPlaces(q)
    setResults(r)
    setActiveIdx(-1)
    setOpen(r.length > 0)
  }, [])

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const val = e.target.value
    setQuery(val)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    if (val.length >= 2) {
      debounceRef.current = setTimeout(() => runSearch(val), 350)
    } else {
      setResults([])
      setOpen(false)
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (!open) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActiveIdx(i => Math.min(i + 1, results.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActiveIdx(i => Math.max(i - 1, 0))
    } else if (e.key === 'Enter' && activeIdx >= 0) {
      e.preventDefault()
      pick(results[activeIdx])
    } else if (e.key === 'Escape') {
      setOpen(false)
    }
  }

  function pick(result: GeocodingResult) {
    const loc: Location = {
      id: crypto.randomUUID(),
      label: result.label,
      lngLat: result.lngLat,
    }
    onSelect(loc)
    setQuery(result.label)
    setResults([])
    setOpen(false)
  }

  function handleClear() {
    setQuery('')
    setResults([])
    setOpen(false)
    onClear()
  }

  useEffect(() => {
    function onOutside(e: MouseEvent) {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onOutside)
    return () => document.removeEventListener('mousedown', onOutside)
  }, [])

  return (
    <div className="loc-input" ref={containerRef}>
      <div className="loc-input__header">
        <span className="loc-input__icon">{icon}</span>
        <span className="loc-input__label">{label}</span>
      </div>
      <div className="loc-input__row">
        <input
          type="text"
          value={query}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          onFocus={() => { onFocus(); if (results.length) setOpen(true) }}
          placeholder={placeholder ?? 'Search for a place…'}
          className="loc-input__field"
        />
        {query && (
          <button className="loc-input__clear" onClick={handleClear} title="Clear">✕</button>
        )}
      </div>
      {open && (
        <ul className="loc-input__dropdown">
          {results.map((r, i) => (
            <li
              key={i}
              className={i === activeIdx ? 'active' : ''}
              onMouseDown={() => pick(r)}
            >
              {r.label}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

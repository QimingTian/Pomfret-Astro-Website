'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { IMAGING_EQUIPMENT_CHANGED, rigDisplayLabel } from '@/lib/imaging/equipment/equipment-store'
import { isEquipmentValid, type ImagingEquipment } from './equipment'

export type ImagingRigEntry = {
  index: number
  equipment: ImagingEquipment
  label: string
}

const SELECTED_RIG_KEY = 'pomfret:plan-selected-rig-index'

function readStoredRigIndex(): number {
  if (typeof window === 'undefined') return 0
  try {
    const raw = window.localStorage.getItem(SELECTED_RIG_KEY)
    const n = raw != null ? Number.parseInt(raw, 10) : 0
    return Number.isFinite(n) && n >= 0 ? n : 0
  } catch {
    return 0
  }
}

function writeStoredRigIndex(index: number): void {
  try {
    window.localStorage.setItem(SELECTED_RIG_KEY, String(index))
  } catch {
    /* ignore quota / private mode */
  }
}

export function useImagingRigs(): {
  rigs: ImagingRigEntry[]
  selectedRig: ImagingEquipment | null
  selectedRigIndex: number
  setSelectedRigIndex: (index: number) => void
} {
  const [rigs, setRigs] = useState<ImagingRigEntry[]>([])
  const [selectedRigIndex, setSelectedRigIndexState] = useState(0)

  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/imaging/equipment', { cache: 'no-store', credentials: 'include' })
      const data = (await res.json().catch(() => null)) as {
        rigs?: Array<{ index: number; equipment: ImagingEquipment }>
      } | null
      if (!res.ok || !Array.isArray(data?.rigs)) {
        setRigs([])
        return
      }
      const next = data.rigs
        .filter((r) => isEquipmentValid(r.equipment))
        .map((r) => ({
          index: r.index,
          equipment: r.equipment,
          label: rigDisplayLabel(r.index, r.equipment),
        }))
      setRigs(next)
      setSelectedRigIndexState((cur) => {
        const stored = readStoredRigIndex()
        const pick = next.some((r) => r.index === stored) ? stored : (next[0]?.index ?? 0)
        const resolved = next.some((r) => r.index === cur) ? cur : pick
        writeStoredRigIndex(resolved)
        return resolved
      })
    } catch {
      setRigs([])
    }
  }, [])

  useEffect(() => {
    void refresh()
    const onChange = () => void refresh()
    window.addEventListener(IMAGING_EQUIPMENT_CHANGED, onChange)
    const id = window.setInterval(() => void refresh(), 30_000)
    return () => {
      window.removeEventListener(IMAGING_EQUIPMENT_CHANGED, onChange)
      window.clearInterval(id)
    }
  }, [refresh])

  const setSelectedRigIndex = useCallback((index: number) => {
    setSelectedRigIndexState(index)
    writeStoredRigIndex(index)
  }, [])

  const selectedRig = useMemo(() => {
    const hit = rigs.find((r) => r.index === selectedRigIndex)
    return hit?.equipment ?? rigs[0]?.equipment ?? null
  }, [rigs, selectedRigIndex])

  return { rigs, selectedRig, selectedRigIndex, setSelectedRigIndex }
}

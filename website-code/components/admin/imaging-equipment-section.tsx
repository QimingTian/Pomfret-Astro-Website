'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { DashboardPanel } from '@/app/dashboard/account/dashboard-panel'
import {
  mergeEquipmentManualSave,
  resolveFieldRotationDeg,
  validateEquipmentInput,
  type ImagingEquipment,
} from '@/lib/imaging/equipment/equipment'
import { rigDisplayLabel, notifyImagingEquipmentChanged } from '@/lib/imaging/equipment/equipment-store'
import { solvePhoto, type PlateSolveStatus } from '@/lib/imaging/equipment/plate-solve'
import {
  glassPillDangerMd,
  glassPillMd,
  glassPillSm,
  glassPillToggleActiveMd,
  glassPillToggleIdleMd,
} from '@/lib/glass-ui'

const emptyForm = () => ({
  eqLabel: '',
  focalLengthMm: '',
  pixelSizeUm: '',
  sensorWidthPx: '',
  sensorHeightPx: '',
  fieldRotationDeg: '0',
})

function rigToForm(rig: ImagingEquipment | null) {
  if (!rig) return emptyForm()
  const rot = resolveFieldRotationDeg(rig)
  return {
    eqLabel: rig.label,
    focalLengthMm: String(rig.focalLengthMm),
    pixelSizeUm: String(rig.pixelSizeUm),
    sensorWidthPx: String(rig.sensorWidthPx),
    sensorHeightPx: String(rig.sensorHeightPx),
    fieldRotationDeg: rot != null ? String(rot) : '0',
  }
}

export function ImagingEquipmentSection() {
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const [rigs, setRigs] = useState<Array<ImagingEquipment | null>>([null])
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [form, setForm] = useState(emptyForm())
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [solving, setSolving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [solveStatus, setSolveStatus] = useState<PlateSolveStatus | null>(null)

  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/imaging-equipment', { credentials: 'include', cache: 'no-store' })
      const data = (await res.json().catch(() => null)) as {
        rigs?: Array<ImagingEquipment | null>
        error?: string
      } | null
      if (!res.ok) {
        setError(data?.error ?? 'Unable to load imaging equipment.')
        return
      }
      const next = Array.isArray(data?.rigs) && data.rigs.length > 0 ? data.rigs : [null]
      setRigs(next)
      setSelectedIndex((cur) => {
        const idx = Math.min(cur, Math.max(0, next.length - 1))
        setForm(rigToForm(next[idx] ?? null))
        return idx
      })
    } catch {
      setError('Unable to load imaging equipment.')
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  function selectRig(index: number) {
    setSelectedIndex(index)
    setForm(rigToForm(rigs[index] ?? null))
    setMessage(null)
    setError(null)
  }

  function addRig() {
    const nextIndex = rigs.length
    setRigs((prev) => [...prev, null])
    setSelectedIndex(nextIndex)
    setForm(emptyForm())
    setMessage(null)
    setError(null)
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setMessage(null)
    const validated = validateEquipmentInput({
      label: form.eqLabel,
      focalLengthMm: form.focalLengthMm,
      pixelSizeUm: form.pixelSizeUm,
      sensorWidthPx: form.sensorWidthPx,
      sensorHeightPx: form.sensorHeightPx,
      fieldRotationDeg: form.fieldRotationDeg,
    })
    if (!validated.ok) {
      setError(validated.error)
      return
    }
    setSaving(true)
    try {
      const merged = mergeEquipmentManualSave(rigs[selectedIndex] ?? null, validated.equipment)
      const res = await fetch('/api/admin/imaging-equipment', {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ index: selectedIndex, equipment: merged }),
      })
      const data = (await res.json().catch(() => null)) as { error?: string; rigs?: Array<ImagingEquipment | null> } | null
      if (!res.ok) {
        setError(data?.error ?? 'Save failed.')
        return
      }
      if (Array.isArray(data?.rigs)) {
        setRigs(data.rigs)
      }
      setMessage(`${rigDisplayLabel(selectedIndex, merged)} saved.`)
      notifyImagingEquipmentChanged()
    } catch {
      setError('Save failed — check your connection and try again.')
    } finally {
      setSaving(false)
    }
  }

  async function handleDeleteRig() {
    if (!window.confirm(`Delete ${rigDisplayLabel(selectedIndex, rigs[selectedIndex] ?? null)}?`)) return
    setDeleting(true)
    setError(null)
    setMessage(null)
    try {
      const res = await fetch(`/api/admin/imaging-equipment?index=${selectedIndex}`, {
        method: 'DELETE',
        credentials: 'include',
      })
      const data = (await res.json().catch(() => null)) as {
        rigs?: Array<ImagingEquipment | null>
        error?: string
      } | null
      if (!res.ok) {
        setError(data?.error ?? 'Delete failed.')
        return
      }
      const next = Array.isArray(data?.rigs) && data.rigs.length > 0 ? data.rigs : [null]
      setRigs(next)
      const idx = Math.min(selectedIndex, next.length - 1)
      setSelectedIndex(idx)
      setForm(rigToForm(next[idx] ?? null))
      setMessage('Rig deleted.')
      notifyImagingEquipmentChanged()
    } catch {
      setError('Delete failed.')
    } finally {
      setDeleting(false)
    }
  }

  async function handlePlateSolve(file: File) {
    setSolving(true)
    setError(null)
    setMessage(null)
    try {
      const result = await solvePhoto(file, setSolveStatus)
      const nextRot =
        result.fieldRotationDeg != null
          ? String((((result.fieldRotationDeg % 360) + 360) % 360).toFixed(2))
          : form.fieldRotationDeg
      const px = Number(form.pixelSizeUm)
      let nextFocal = form.focalLengthMm
      if (Number.isFinite(px) && px > 0) {
        nextFocal = ((px / result.arcsecPerPixel) * (206264.8062471 / 1000)).toFixed(1)
      }
      const nextForm = {
        ...form,
        focalLengthMm: nextFocal,
        sensorWidthPx: String(result.sensorWidthPx),
        sensorHeightPx: String(result.sensorHeightPx),
        fieldRotationDeg: nextRot,
      }
      setForm(nextForm)
      const validated = validateEquipmentInput({
        label: nextForm.eqLabel,
        focalLengthMm: nextForm.focalLengthMm,
        pixelSizeUm: nextForm.pixelSizeUm,
        sensorWidthPx: nextForm.sensorWidthPx,
        sensorHeightPx: nextForm.sensorHeightPx,
        fieldRotationDeg: nextForm.fieldRotationDeg,
      })
      if (validated.ok) {
        const payload: ImagingEquipment = {
          ...validated.equipment,
          positionAngleDeg: result.orientationDeg ?? undefined,
          rawImageOrientationDeg: result.rawImageOrientationDeg ?? undefined,
          imageParity: result.parity,
        }
        const res = await fetch('/api/admin/imaging-equipment', {
          method: 'PUT',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ index: selectedIndex, equipment: payload }),
        })
        const data = (await res.json().catch(() => null)) as { rigs?: Array<ImagingEquipment | null>; error?: string } | null
        if (res.ok) {
          if (Array.isArray(data?.rigs)) setRigs(data.rigs)
          const ninaPa =
            result.orientationDeg != null
              ? ` · NINA PA ${(((result.orientationDeg % 360) + 360) % 360).toFixed(1)}°`
              : ''
          setMessage(
            `Plate-solved and saved: ${result.arcsecPerPixel.toFixed(2)}″/px · frame ${nextRot}°${ninaPa}.`,
          )
          notifyImagingEquipmentChanged()
        } else {
          setError(data?.error ?? 'Could not save plate-solve result.')
        }
      } else {
        setMessage('Solved — fill remaining fields and Save.')
      }
    } catch (ex) {
      setError(ex instanceof Error ? ex.message : 'Plate solving failed.')
    } finally {
      setSolving(false)
      setSolveStatus(null)
    }
  }

  return (
    <DashboardPanel title="Imaging Equipment">
      <div className="space-y-4">
        <div className="flex flex-wrap gap-2">
          {rigs.map((rig, i) => {
            const active = i === selectedIndex
            return (
              <button
                key={`rig-pill-${i}`}
                type="button"
                aria-pressed={active}
                onClick={() => selectRig(i)}
                className={active ? glassPillToggleActiveMd : glassPillToggleIdleMd}
              >
                {rigDisplayLabel(i, rig)}
              </button>
            )
          })}
          <button type="button" onClick={addRig} className={glassPillSm}>
            Add Rig
          </button>
        </div>

        <form className="grid gap-3 sm:grid-cols-2" onSubmit={handleSave}>
          <label className="block text-sm sm:col-span-2">
            <span className="text-sm font-medium text-white">Rig name</span>
            <input
              value={form.eqLabel}
              onChange={(e) => setForm((f) => ({ ...f, eqLabel: e.target.value }))}
              placeholder={rigDisplayLabel(selectedIndex, null)}
              className="mt-1 w-full rounded-lg border border-gray-300 bg-transparent px-3 py-2 text-sm dark:border-gray-600"
            />
          </label>
          {(
            [
              ['Focal length (mm)', 'focalLengthMm'],
              ['Pixel size (µm)', 'pixelSizeUm'],
              ['Sensor width (px)', 'sensorWidthPx'],
              ['Sensor height (px)', 'sensorHeightPx'],
              ['Field rotation (°)', 'fieldRotationDeg'],
            ] as const
          ).map(([label, key]) => (
            <label key={key} className="block text-sm">
              <span className="text-sm font-medium text-white">{label}</span>
              <input
                value={form[key]}
                onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
                className="mt-1 w-full rounded-lg border border-gray-300 bg-transparent px-3 py-2 text-sm dark:border-gray-600"
              />
            </label>
          ))}
          <div className="flex flex-wrap items-center gap-2 sm:col-span-2">
            <button type="submit" disabled={saving || solving || deleting} className={glassPillMd}>
              {saving ? 'Saving…' : 'Save'}
            </button>
            <button
              type="button"
              disabled={saving || solving || deleting}
              onClick={() => fileInputRef.current?.click()}
              className={glassPillMd}
            >
              {solving ? (solveStatus ?? 'Solving…') : 'Plate-solve image'}
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*,.fit,.fits,.fts,application/fits"
              className="hidden"
              disabled={solving}
              onChange={(e) => {
                const f = e.target.files?.[0]
                if (f) void handlePlateSolve(f)
                e.target.value = ''
              }}
            />
            <button
              type="button"
              disabled={saving || solving || deleting}
              onClick={() => void handleDeleteRig()}
              className={glassPillDangerMd}
            >
              {deleting ? 'Deleting…' : 'Delete Rig'}
            </button>
          </div>
        </form>
        {message ? <p className="text-sm text-emerald-400">{message}</p> : null}
        {error ? <p className="text-sm text-red-400">{error}</p> : null}
      </div>
    </DashboardPanel>
  )
}

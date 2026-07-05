'use client'

import {
  glassPillToggleActiveInverted,
  glassPillToggleIdleSm,
} from '@/lib/glass-ui'
import type { ImagingRigEntry } from '@/lib/imaging/equipment/use-imaging-rigs'

const layerPillClass = (active: boolean) =>
  active ? glassPillToggleActiveInverted : glassPillToggleIdleSm

export type LayerKey = 'landscapes' | 'atmosphere' | 'dsos' | 'dss' | 'azimuthal' | 'equatorial'

export const LAYER_LABELS: Record<LayerKey, string> = {
  landscapes: 'Ground',
  atmosphere: 'Atmosphere',
  dsos: 'Deep sky',
  dss: 'DSS imagery',
  azimuthal: 'Azimuthal grid',
  equatorial: 'Equatorial grid',
}

export const LAYER_ORDER: LayerKey[] = ['landscapes', 'atmosphere', 'dsos', 'dss', 'azimuthal', 'equatorial']

type Props = {
  layers: Record<LayerKey, boolean>
  nightMode: boolean
  alt30OverlayOn: boolean
  orbitOverlayOn: boolean
  stelReady: boolean
  /** Equal spacing above Framing mosaic divider. */
  padBottom?: boolean
  rigs?: ImagingRigEntry[]
  selectedRigIndex?: number
  onSelectRig?: (index: number) => void
  onToggleLayer: (k: LayerKey) => void
  onToggleNightMode: () => void
  onToggleAlt30: () => void
  onToggleOrbit: () => void
}

export function PlanSkyLayers({
  layers,
  nightMode,
  alt30OverlayOn,
  orbitOverlayOn,
  stelReady,
  padBottom = false,
  rigs = [],
  selectedRigIndex = 0,
  onSelectRig,
  onToggleLayer,
  onToggleNightMode,
  onToggleAlt30,
  onToggleOrbit,
}: Props) {
  return (
    <section
      aria-label="Sky layers and equipment"
      className={`flex flex-wrap justify-center gap-2${padBottom ? ' pb-4' : ''}`}
    >
      {rigs.length > 1
        ? rigs.map((rig) => {
            const active = rig.index === selectedRigIndex
            return (
              <button
                key={`rig-${rig.index}`}
                type="button"
                aria-pressed={active}
                onClick={() => onSelectRig?.(rig.index)}
                className={layerPillClass(active)}
              >
                {rig.label}
              </button>
            )
          })
        : null}
      {LAYER_ORDER.map((k) => {
        const active = layers[k]
        return (
          <button
            key={k}
            type="button"
            onClick={() => onToggleLayer(k)}
            disabled={!stelReady}
            aria-pressed={active}
            className={layerPillClass(active)}
          >
            {LAYER_LABELS[k]}
          </button>
        )
      })}
      <button
        type="button"
        onClick={onToggleNightMode}
        aria-pressed={nightMode}
        className={layerPillClass(nightMode)}
      >
        Night mode
      </button>
      <button
        type="button"
        onClick={onToggleAlt30}
        aria-pressed={alt30OverlayOn}
        disabled={!stelReady}
        title="Show altitude 30° ring"
        className={layerPillClass(alt30OverlayOn)}
      >
        Alt 30°
      </button>
      <button
        type="button"
        onClick={onToggleOrbit}
        aria-pressed={orbitOverlayOn}
        disabled={!stelReady}
        title="Show solid orbit track for the selected object"
        className={layerPillClass(orbitOverlayOn)}
      >
        Orbit
      </button>
    </section>
  )
}

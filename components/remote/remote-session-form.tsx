'use client'

import type { Ref, FormEvent, Dispatch, SetStateAction } from 'react'
import { MemberAuthPanel } from '@/components/member-auth-panel'
import type { MemberProfile } from '@/components/member-provider'
import type { VariableStarRow } from '@/lib/variable-star-catalog'
import {
  VARIABLE_STAR_FILTER_OPTIONS,
  type VariableStarFilterId,
} from '@/lib/variable-star/filters'
import type { MosaicDraft } from '@/lib/mosaic/framing-rectangle'
import { VariableStarPreviewCharts, type VariableStarChartStar } from '@/app/dashboard/remote/variable-star-preview-charts'
import { formatDurationShort } from '@/lib/remote/format'
import type { FilterPlanFormRow } from '@/lib/remote/mosaic-form'
import { statusLabel, type ObservatoryStatus } from '@/lib/remote/ui-status'
import {
  glassPillDisabled,
  glassPillFullWidthMd,
  glassPillMd,
  glassPillToggleActive,
  glassPillToggleActiveMd,
  glassPillToggleDisabledMd,
  glassPillToggleIdle,
  glassPillToggleIdleMd,
} from '@/lib/glass-ui'

const FILTER_OPTIONS = [
  { value: 'L', label: 'Luminance' },
  { value: 'R', label: 'Red' },
  { value: 'G', label: 'Green' },
  { value: 'B', label: 'Blue' },
  { value: 'S', label: 'Sulfur' },
  { value: 'H', label: 'Hydrogen' },
  { value: 'O', label: 'Oxygen' },
] as const

function formatTonightXAxisHour(ms: number): string {
  const d = new Date(ms)
  const h24 = d.getHours()
  const h12 = h24 % 12 || 12
  const ampm = h24 < 12 ? 'AM' : 'PM'
  return `${h12}${ampm}`
}

type ImagingSessionTypeUi = 'dso' | 'variable_star'
type ProjectModeTri = 'off' | 'on' | 'mosaic'
type VariableStarLookupSource = 'catalog' | 'simbad'
type VariableStarFilterUi = VariableStarFilterId

type ResolvedCatalogObject = {
  query: string
  canonicalName: string
  aliases: string[]
  raHours: number
  decDeg: number
  ra: { hour: number; minute: number; second: number }
  dec: { sign: '+' | '-'; degree: number; minute: number; second: number }
}

type DsoTonightAltitudePreview = {
  duskMs: number
  dawnMs: number
  xTickMs: number[]
  samples: Array<{ ms: number; alt: number }>
}

type VariableStarDurationPick =
  | null
  | ({
      coordsOk: false
      allOptions: number[]
      nightHours: number
      nightHalfSteps: number
      starHalfSteps: number
      above30Ms: number
      above30Hours: number
    })
  | ({
      coordsOk: true
      raHours: number
      decDeg: number
      above30Ms: number
      nightHours: number
      above30Hours: number
      nightHalfSteps: number
      starHalfSteps: number
      allOptions: number[]
    })

type MemberState =
  | { status: 'loading' }
  | { status: 'guest' }
  | { status: 'authenticated'; user: MemberProfile }

type RemoteSessionFormMember = MemberState & {
  refresh: () => Promise<void>
  completeSignIn: (user: MemberProfile) => void
}

export type RemoteSessionFormProps = {
  status: ObservatoryStatus
  showTonightWeatherHeadline: boolean
  tonightWeatherPrediction: 'permitted' | 'not_permitted' | 'unavailable' | 'loading'
  statusLoadError: string | null
  member: RemoteSessionFormMember
  isLoggedIn: boolean
  imagingAccess: { ok: true } | { ok: false; error: string }
  verifySending: boolean
  setVerifySending: Dispatch<SetStateAction<boolean>>
  verifyMsg: string | null
  setVerifyMsg: Dispatch<SetStateAction<string | null>>
  handleSubmit: (e: FormEvent) => void | Promise<void>
  sessionType: ImagingSessionTypeUi
  setSessionType: Dispatch<SetStateAction<ImagingSessionTypeUi>>
  filterPlans: FilterPlanFormRow[]
  setFilterPlans: Dispatch<SetStateAction<FilterPlanFormRow[]>>
  panelFilterPlansById: Record<number, FilterPlanFormRow[]>
  setPanelFilterPlansById: Dispatch<SetStateAction<Record<number, FilterPlanFormRow[]>>>
  catalogQuery: string
  setCatalogQuery: Dispatch<SetStateAction<string>>
  variableStarPreviewStar: VariableStarChartStar | null
  setVariableStarPreviewStar: Dispatch<SetStateAction<VariableStarChartStar | null>>
  variableStarLastFoundName: string | null
  setVariableStarLastFoundName: Dispatch<SetStateAction<string | null>>
  variableStarLastFoundSource: VariableStarLookupSource | null
  setVariableStarLastFoundSource: Dispatch<SetStateAction<VariableStarLookupSource | null>>
  variableStarListSelection: string
  setVariableStarListSelection: Dispatch<SetStateAction<string>>
  variableStarFilterSelection: VariableStarFilterUi[]
  setVariableStarFilterSelection: Dispatch<SetStateAction<VariableStarFilterUi[]>>
  catalogLookupError: string | null
  setCatalogLookupError: Dispatch<SetStateAction<string | null>>
  catalogLookupResult: ResolvedCatalogObject | null
  setCatalogLookupResult: Dispatch<SetStateAction<ResolvedCatalogObject | null>>
  variableStarBlockHours: number
  setVariableStarBlockHours: Dispatch<SetStateAction<number>>
  editingSessionId: string | null
  setEditingSessionId: Dispatch<SetStateAction<string | null>>
  requestName: string
  setRequestName: Dispatch<SetStateAction<string>>
  raHourPart: string
  setRaHourPart: Dispatch<SetStateAction<string>>
  raMinutePart: string
  setRaMinutePart: Dispatch<SetStateAction<string>>
  raSecondPart: string
  setRaSecondPart: Dispatch<SetStateAction<string>>
  decSign: string
  setDecSign: Dispatch<SetStateAction<string>>
  decDegreePart: string
  setDecDegreePart: Dispatch<SetStateAction<string>>
  decMinutePart: string
  setDecMinutePart: Dispatch<SetStateAction<string>>
  decSecondPart: string
  setDecSecondPart: Dispatch<SetStateAction<string>>
  sessionPassword: string
  setSessionPassword: Dispatch<SetStateAction<string>>
  outputMode: 'raw_zip' | 'stacked_master' | 'none'
  setOutputMode: Dispatch<SetStateAction<'raw_zip' | 'stacked_master' | 'none'>>
  projectModeTri: ProjectModeTri
  setProjectModeTri: Dispatch<SetStateAction<ProjectModeTri>>
  enableMosaicMode: () => void
  variableStarCatalogLoading: boolean
  variableStarCatalogError: string | null
  variableStarFilterDropdownRef: Ref<HTMLDivElement>
  variableStarFilterDropdownOpen: boolean
  setVariableStarFilterDropdownOpen: Dispatch<SetStateAction<boolean>>
  variableStarFilterKey: string
  variableStarCatalog: VariableStarRow[]
  displayedVariableStars: VariableStarRow[]
  applyVariableStarCatalogRow: (row: VariableStarRow, source: VariableStarLookupSource) => void
  variableStarSimbadSearching: boolean
  handleCatalogLookup: () => void | Promise<void>
  mosaicMode: boolean
  mosaicDraft: MosaicDraft | null
  selectedMosaicPanelId: number
  selectMosaicPanel: (id: number) => void
  addMosaicPanel: () => void
  catalogLookupLoading: boolean
  dsoTonightAltitudePreview: DsoTonightAltitudePreview | null
  variableStarDurationPick: VariableStarDurationPick
  variableStarDurationUserSelected: boolean
  setVariableStarDurationUserSelected: Dispatch<SetStateAction<boolean>>
  ambientTempC: number | null
  cameraCoolingTempC: -10 | 0
  setCameraCoolingTempC: Dispatch<SetStateAction<-10 | 0>>
  submitError: string | null
  submitSuccess: string | null
  submitting: boolean
  setRunModalError: Dispatch<SetStateAction<string | null>>
  setRunModalName: Dispatch<SetStateAction<string>>
  setShowRunRemoteSessionModal: Dispatch<SetStateAction<boolean>>
  canSaveRemoteSessionSpec: boolean
  setSaveModalError: Dispatch<SetStateAction<string | null>>
  setSaveModalName: Dispatch<SetStateAction<string>>
  setShowSaveRemoteSessionModal: Dispatch<SetStateAction<boolean>>
  dsoEstimatedDurationPreviewSeconds: number | null
  variableStarEstimatedDurationPreviewSeconds: number | null
}

export function RemoteSessionForm({
  status,
  showTonightWeatherHeadline,
  tonightWeatherPrediction,
  statusLoadError,
  member,
  isLoggedIn,
  imagingAccess,
  verifySending,
  setVerifySending,
  verifyMsg,
  setVerifyMsg,
  handleSubmit,
  sessionType,
  setSessionType,
  filterPlans,
  setFilterPlans,
  panelFilterPlansById,
  setPanelFilterPlansById,
  catalogQuery,
  setCatalogQuery,
  variableStarPreviewStar,
  setVariableStarPreviewStar,
  variableStarLastFoundName,
  setVariableStarLastFoundName,
  variableStarLastFoundSource,
  setVariableStarLastFoundSource,
  variableStarListSelection,
  setVariableStarListSelection,
  variableStarFilterSelection,
  setVariableStarFilterSelection,
  catalogLookupError,
  setCatalogLookupError,
  catalogLookupResult,
  setCatalogLookupResult,
  variableStarBlockHours,
  setVariableStarBlockHours,
  editingSessionId,
  setEditingSessionId,
  requestName,
  setRequestName,
  raHourPart,
  setRaHourPart,
  raMinutePart,
  setRaMinutePart,
  raSecondPart,
  setRaSecondPart,
  decSign,
  setDecSign,
  decDegreePart,
  setDecDegreePart,
  decMinutePart,
  setDecMinutePart,
  decSecondPart,
  setDecSecondPart,
  sessionPassword,
  setSessionPassword,
  outputMode,
  setOutputMode,
  projectModeTri,
  setProjectModeTri,
  enableMosaicMode,
  variableStarCatalogLoading,
  variableStarCatalogError,
  variableStarFilterDropdownRef,
  variableStarFilterDropdownOpen,
  setVariableStarFilterDropdownOpen,
  variableStarFilterKey,
  variableStarCatalog,
  displayedVariableStars,
  applyVariableStarCatalogRow,
  variableStarSimbadSearching,
  handleCatalogLookup,
  mosaicMode,
  mosaicDraft,
  selectedMosaicPanelId,
  selectMosaicPanel,
  addMosaicPanel,
  catalogLookupLoading,
  dsoTonightAltitudePreview,
  variableStarDurationPick,
  variableStarDurationUserSelected,
  setVariableStarDurationUserSelected,
  ambientTempC,
  cameraCoolingTempC,
  setCameraCoolingTempC,
  submitError,
  submitSuccess,
  submitting,
  setRunModalError,
  setRunModalName,
  setShowRunRemoteSessionModal,
  canSaveRemoteSessionSpec,
  setSaveModalError,
  setSaveModalName,
  setShowSaveRemoteSessionModal,
  dsoEstimatedDurationPreviewSeconds,
  variableStarEstimatedDurationPreviewSeconds,
}: RemoteSessionFormProps) {
  return (
        <section className="max-w-3xl min-w-0">
          <h1 className="text-2xl font-semibold text-apple-dark dark:text-white mb-4">New Imaging Session</h1>
          <div className="flex flex-col gap-4">
            <p className="text-sm text-gray-600 dark:text-gray-400">
          Observatory status:{' '}
          <span
            className={
              status === 'ready'
                ? 'text-green-600 dark:text-green-400'
                : status === 'loading'
                  ? 'text-gray-500 dark:text-gray-500'
                  : 'text-red-600 dark:text-red-400'
            }
          >
            {statusLabel(status)}
          </span>
          {showTonightWeatherHeadline ? (
            <>
              <span className="px-2 text-gray-500 dark:text-gray-500">|</span>
              Tonight&apos;s weather prediction:{' '}
              <span
                className={
                  tonightWeatherPrediction === 'permitted'
                    ? 'text-green-600 dark:text-green-400'
                    : tonightWeatherPrediction === 'loading' ||
                        tonightWeatherPrediction === 'unavailable'
                      ? 'text-gray-500 dark:text-gray-500'
                      : 'text-red-600 dark:text-red-400'
                }
              >
                {tonightWeatherPrediction === 'permitted'
                  ? 'Permitted'
                  : tonightWeatherPrediction === 'loading'
                    ? 'Loading...'
                    : tonightWeatherPrediction === 'unavailable'
                      ? 'Unavailable'
                      : 'Not permitted'}
              </span>
            </>
          ) : null}
            </p>
            {statusLoadError && (
              <p className="text-sm text-red-600 dark:text-red-400">{statusLoadError}</p>
            )}
            {member.status === 'loading' ? (
              <p className="py-14 text-center text-sm text-gray-500">…</p>
            ) : !isLoggedIn ? (
              <MemberAuthPanel
                onSignedIn={(user) => {
                  if (user) member.completeSignIn(user)
                  else void member.refresh()
                }}
              />
            ) : (
            <>
            {!imagingAccess.ok ? (
              member.status === 'authenticated' && !member.user.emailVerified ? (
                <div className="rounded-lg border border-amber-500/40 bg-transparent px-4 py-3 text-sm text-amber-100">
                  <p>Verify your email before submitting imaging sessions.</p>
                  <button
                    type="button"
                    disabled={verifySending}
                    onClick={async () => {
                      setVerifySending(true)
                      setVerifyMsg(null)
                      try {
                        const res = await fetch('/api/auth/verify-email', {
                          method: 'POST',
                          credentials: 'include',
                        })
                        const data = await res.json().catch(() => ({}))
                        if (!res.ok || data?.ok !== true) {
                          setVerifyMsg(typeof data.error === 'string' ? data.error : 'Could not send email.')
                          return
                        }
                        setVerifyMsg('Verification email sent. Check your inbox.')
                      } catch {
                        setVerifyMsg('Could not send email.')
                      } finally {
                        setVerifySending(false)
                      }
                    }}
                    className={`${glassPillMd} mt-2 disabled:opacity-50`}
                  >
                    {verifySending ? 'Sending…' : 'Resend verification email'}
                  </button>
                  {verifyMsg ? <p className="mt-2 text-xs text-amber-200/90">{verifyMsg}</p> : null}
                </div>
              ) : (
                <div className="rounded-lg border border-amber-500/40 bg-transparent px-4 py-3 text-sm text-amber-100">
                  <p>{imagingAccess.error}</p>
                </div>
              )
            ) : null}
            <form onSubmit={handleSubmit} className="boxed-fields grid gap-4 sm:grid-cols-2">
            <fieldset disabled={!imagingAccess.ok} className="contents min-w-0 border-0 p-0 m-0">
          <div className="sm:col-span-2 flex flex-wrap items-start gap-x-10 gap-y-4">
            <div className="space-y-2 min-w-0">
            <span className="text-sm font-medium text-white">Session Type</span>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                aria-pressed={sessionType === 'dso'}
                onClick={() => {
                  setSessionType('dso')
                  setFilterPlans([])
                  setPanelFilterPlansById({})
                  setCatalogQuery('')
                  setVariableStarPreviewStar(null)
                  setVariableStarLastFoundName(null)
                  setVariableStarLastFoundSource(null)
                  setVariableStarListSelection('')
                  setVariableStarFilterSelection([])
                  setCatalogLookupError(null)
                  setCatalogLookupResult(null)
                  setVariableStarBlockHours(1)
                }}
                className={sessionType === 'dso' ? glassPillToggleActiveMd : glassPillToggleIdleMd}
              >
                Deep Sky Object Imaging
              </button>
              <button
                type="button"
                aria-pressed={sessionType === 'variable_star'}
                onClick={() => {
                  setEditingSessionId(null)
                  setRequestName('')
                  setRaHourPart('')
                  setRaMinutePart('')
                  setRaSecondPart('')
                  setDecSign('+')
                  setDecDegreePart('')
                  setDecMinutePart('')
                  setDecSecondPart('')
                  setSessionPassword('')
                  setCatalogQuery('')
                  setCatalogLookupResult(null)
                  setCatalogLookupError(null)
                  setVariableStarPreviewStar(null)
                  setVariableStarLastFoundName(null)
                  setVariableStarLastFoundSource(null)
                  setVariableStarListSelection('')
                  setVariableStarFilterSelection([])
                  setSessionType('variable_star')
                  setOutputMode('raw_zip')
                  setFilterPlans([{ filterName: 'G', count: '10', exposureSeconds: '60' }])
                  setVariableStarBlockHours(1)
                }}
                className={sessionType === 'variable_star' ? glassPillToggleActiveMd : glassPillToggleIdleMd}
              >
                Variable Star Imaging
              </button>
            </div>
            </div>
            {sessionType === 'dso' && (
              <div className="space-y-2">
                <span className="text-sm font-medium text-white">Project Mode</span>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    aria-pressed={projectModeTri === 'off'}
                    onClick={() => setProjectModeTri('off')}
                    className={projectModeTri === 'off' ? glassPillToggleActiveMd : glassPillToggleIdleMd}
                  >
                    Off
                  </button>
                  <button
                    type="button"
                    aria-pressed={projectModeTri === 'on'}
                    onClick={() => setProjectModeTri('on')}
                    className={projectModeTri === 'on' ? glassPillToggleActiveMd : glassPillToggleIdleMd}
                  >
                    On
                  </button>
                  <button
                    type="button"
                    aria-pressed={projectModeTri === 'mosaic'}
                    onClick={enableMosaicMode}
                    className={projectModeTri === 'mosaic' ? glassPillToggleActiveMd : glassPillToggleIdleMd}
                  >
                    Mosaic On
                  </button>
                </div>
              </div>
            )}
          </div>
          {sessionType === 'variable_star' && variableStarCatalogLoading && (
            <p className="sm:col-span-2 text-xs text-gray-400">Loading variable star catalog…</p>
          )}
          {sessionType === 'variable_star' && variableStarCatalogError && !variableStarCatalogLoading && (
            <p className="sm:col-span-2 text-xs text-red-400">{variableStarCatalogError}</p>
          )}
          <label className="sm:col-span-2 block space-y-1">
            <span className="text-sm font-medium text-white">Session Name *</span>
            <input
              required
              type="text"
              value={requestName}
              onChange={(e) => setRequestName(e.target.value)}
              placeholder={
                sessionType === 'variable_star'
                  ? 'e.g. AW UMa Session 1'
                  : 'e.g. M31 LRGB Session 1'
              }
              className="w-full rounded-full border border-gray-300 dark:border-gray-600 bg-transparent dark:bg-transparent px-3 py-2 text-sm"
            />
          </label>
          <div className="sm:col-span-2 space-y-3">
            {sessionType === 'variable_star' ? (
              <div className="space-y-4">
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  <label className="block w-full space-y-1">
                    <span className="text-sm font-medium text-white">Star Filter</span>
                    <div className="relative" ref={variableStarFilterDropdownRef}>
                      <button
                        type="button"
                        onClick={() => setVariableStarFilterDropdownOpen((prev) => !prev)}
                        className={`box-border flex h-10 w-full items-center justify-center rounded-full border border-gray-300 bg-transparent px-3 py-2 text-sm leading-normal dark:border-gray-600 ${
                          variableStarFilterSelection.length === 0 ? 'text-gray-400' : 'text-white'
                        }`}
                      >
                        {variableStarFilterSelection.length === 0
                          ? '-- Select Filter --'
                          : `${variableStarFilterSelection.length} Filter${variableStarFilterSelection.length > 1 ? 's' : ''} Selected`}
                      </button>
                      {variableStarFilterDropdownOpen && (
                        <div className="absolute z-20 mt-1 w-full rounded-2xl border border-gray-300 bg-[#151616] p-2 text-sm dark:border-gray-600">
                          {VARIABLE_STAR_FILTER_OPTIONS.map((option) => {
                            const checked = variableStarFilterSelection.includes(option.value)
                            return (
                              <label
                                key={option.value}
                                className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-white hover:bg-white/5"
                              >
                                <input
                                  type="checkbox"
                                  checked={checked}
                                  onChange={(e) => {
                                    setVariableStarFilterSelection((prev) =>
                                      e.target.checked
                                        ? [...prev, option.value]
                                        : prev.filter((x) => x !== option.value)
                                    )
                                  }}
                                  className="h-4 w-4 accent-gray-300"
                                />
                                <span>{option.label}</span>
                              </label>
                            )
                          })}
                        </div>
                      )}
                    </div>
                  </label>
                  <label className="block w-full space-y-1">
                    <span className="text-sm font-medium text-white">Star List</span>
                    <select
                      key={variableStarFilterKey}
                      value={variableStarListSelection}
                      disabled={variableStarCatalogLoading || displayedVariableStars.length === 0}
                      onChange={(e) => {
                        const v = e.target.value
                        setVariableStarListSelection(v)
                        if (!v) return
                        const row = variableStarCatalog.find((s) => s.name === v)
                        if (row) applyVariableStarCatalogRow(row, 'catalog')
                      }}
                      className={`box-border h-10 w-full appearance-none rounded-full border border-gray-300 dark:border-gray-600 bg-[#151616] px-3 py-2 text-center text-sm leading-normal ${
                        variableStarListSelection ? 'text-white' : 'text-gray-400'
                      }`}
                      style={{ textAlignLast: 'center' }}
                    >
                      <option value="" className="text-center text-gray-400">
                        -- Select A Star--
                      </option>
                      {displayedVariableStars.map((s) => (
                        <option key={s.name} value={s.name} className="text-center text-gray-300">
                          {s.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="relative block w-full space-y-1">
                    <span className="text-sm font-medium text-white">Search A Star</span>
                    {variableStarSimbadSearching && (
                      <span className="absolute right-0 top-0 text-sm font-medium text-gray-400">
                        Searching In SIMBAD
                      </span>
                    )}
                    <input
                      type="text"
                      value={catalogQuery}
                      onChange={(e) => {
                        setCatalogQuery(e.target.value)
                        setVariableStarListSelection('')
                      }}
                      onKeyDown={(e) => {
                        if (e.key !== 'Enter') return
                        e.preventDefault()
                        void handleCatalogLookup()
                      }}
                      placeholder="e.g. RR Lyr"
                      className="box-border h-10 w-full rounded-full border border-gray-300 dark:border-gray-600 bg-transparent px-3 py-2 text-sm leading-normal dark:bg-transparent"
                    />
                  </label>
                </div>
                <VariableStarPreviewCharts star={variableStarPreviewStar} />
              </div>
            ) : (
              <div className="space-y-3">
                {mosaicMode ? (
                  <div className="space-y-2">
                    <span className="text-sm font-medium text-white">Mosaic</span>
                    <div className="flex flex-wrap items-center gap-2">
                      {(mosaicDraft?.panels ?? []).map((p) => (
                        <button
                          key={p.id}
                          type="button"
                          aria-pressed={selectedMosaicPanelId === p.id}
                          onClick={() => selectMosaicPanel(p.id)}
                          className={
                            selectedMosaicPanelId === p.id ? glassPillToggleActiveMd : glassPillToggleIdleMd
                          }
                        >
                          {p.name}
                        </button>
                      ))}
                      <button type="button" onClick={addMosaicPanel} className={glassPillMd}>
                        Add Panel
                      </button>
                    </div>
                  </div>
                ) : null}
                <div className="flex flex-wrap items-end gap-2">
                  <label className="min-w-[12rem] flex-1 basis-[min(100%,20rem)] space-y-1">
                    <span className="text-sm font-medium text-white">Catalog Target Search</span>
                    <input
                      type="text"
                      value={catalogQuery}
                      onChange={(e) => setCatalogQuery(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key !== 'Enter') return
                        e.preventDefault()
                        void handleCatalogLookup()
                      }}
                      placeholder="Try M31, NGC 7000, IC 434, M42..."
                      className="w-full rounded-full border border-gray-300 dark:border-gray-600 bg-transparent dark:bg-transparent px-3 py-2 text-sm"
                    />
                  </label>
                  <button
                    type="button"
                    onClick={() => {
                      void handleCatalogLookup()
                    }}
                    disabled={catalogLookupLoading}
                    className={`${glassPillMd} disabled:opacity-60`}
                  >
                    {catalogLookupLoading ? 'Searching...' : 'Search Target'}
                  </button>
                </div>
              </div>
            )}
            {catalogLookupError && <p className="text-sm text-red-400">{catalogLookupError}</p>}
            {sessionType === 'dso' && catalogLookupResult && (
              <p className="text-sm text-green-400">
                Found <span className="font-semibold">{catalogLookupResult.canonicalName}</span>. Coordinates auto-filled.
              </p>
            )}
            {sessionType === 'dso' && catalogLookupResult && dsoTonightAltitudePreview && (
              <div className="sm:col-span-2 space-y-1">
                <p className="text-sm font-medium text-white">Tonight</p>
                <div className="rounded-lg border border-black/10 p-2 dark:border-white/10">
                  {(() => {
                    const VB_W = 420
                    const VB_H = 168
                    const PAD_L = 30
                    const PAD_R = 26
                    const PAD_T = 24
                    const PAD_B = 22
                    const plotW = VB_W - PAD_L - PAD_R
                    const plotH = VB_H - PAD_T - PAD_B
                    const xTickY0 = PAD_T + plotH
                    const spanMs = Math.max(1, dsoTonightAltitudePreview.dawnMs - dsoTonightAltitudePreview.duskMs)
                    const x = (ms: number) => PAD_L + ((ms - dsoTonightAltitudePreview.duskMs) / spanMs) * plotW
                    const yAlt = (alt: number) => PAD_T + ((90 - Math.max(0, Math.min(90, alt))) / 90) * plotH
                    const points = dsoTonightAltitudePreview.samples
                      .map((p) => `${x(p.ms).toFixed(1)},${yAlt(p.alt).toFixed(1)}`)
                      .join(' ')
                    return (
                      <svg className="block w-full -translate-x-1 -translate-y-1 text-gray-600" viewBox={`0 0 ${VB_W} ${VB_H}`} aria-hidden>
                        <rect x={PAD_L} y={PAD_T} width={plotW} height={plotH} fill="none" stroke="currentColor" strokeOpacity={0.2} />
                        <line x1={PAD_L} y1={xTickY0} x2={PAD_L + plotW} y2={xTickY0} stroke="currentColor" strokeOpacity={0.35} />
                        {[0, 30, 60, 90].map((deg) => {
                          const y = PAD_T + ((90 - deg) / 90) * plotH
                          return (
                            <g key={deg}>
                              <line x1={PAD_L} y1={y} x2={PAD_L + plotW} y2={y} stroke="currentColor" strokeOpacity={0.08} />
                              <text x={PAD_L + plotW + 6} y={y + 3} fill="rgb(156 163 175)" fontSize={8} textAnchor="start">
                                {`${deg}°`}
                              </text>
                            </g>
                          )
                        })}
                        <polyline fill="none" stroke="rgb(251 191 36)" strokeWidth="1.4" points={points} />
                        {dsoTonightAltitudePreview.xTickMs.map((ms) => {
                          const xi = x(ms)
                          return (
                            <g key={ms}>
                              <line x1={xi} y1={xTickY0} x2={xi} y2={xTickY0 + 4} stroke="currentColor" strokeOpacity={0.4} />
                              <text x={xi} y={xTickY0 + 10} fill="rgb(156 163 175)" fontSize={8} textAnchor="middle" dominantBaseline="hanging">
                                {formatTonightXAxisHour(ms)}
                              </text>
                            </g>
                          )
                        })}
                      </svg>
                    )
                  })()}
                </div>
              </div>
            )}
            {sessionType === 'variable_star' && variableStarLastFoundName && (
              <p className="text-sm text-green-400">
                Found <span className="font-semibold">{variableStarLastFoundName}</span>{' '}
                {variableStarLastFoundSource === 'simbad' ? '(SIMBAD)' : '(Index Catalog)'}.
                Coordinates auto-filled.
              </p>
            )}
          </div>
          <div className="sm:col-span-2 grid gap-2">
            <span className="text-sm font-medium text-white">Right Ascension (RA) *</span>
            <div className="grid grid-cols-3 gap-3">
              <input
                required
                type="text"
                inputMode="numeric"
                value={raHourPart}
                onChange={(e) => setRaHourPart(e.target.value)}
                placeholder="Hour"
                className="w-full rounded-full border border-gray-300 dark:border-gray-600 bg-transparent dark:bg-transparent px-3 py-2 text-sm"
              />
              <input
                required
                type="text"
                inputMode="numeric"
                value={raMinutePart}
                onChange={(e) => setRaMinutePart(e.target.value)}
                placeholder="Min"
                className="w-full rounded-full border border-gray-300 dark:border-gray-600 bg-transparent dark:bg-transparent px-3 py-2 text-sm"
              />
              <input
                required
                type="text"
                inputMode="decimal"
                value={raSecondPart}
                onChange={(e) => setRaSecondPart(e.target.value)}
                placeholder="Sec"
                className="w-full rounded-full border border-gray-300 dark:border-gray-600 bg-transparent dark:bg-transparent px-3 py-2 text-sm"
              />
            </div>
          </div>
          <div className="sm:col-span-2 grid gap-2">
            <span className="text-sm font-medium text-white">Declination (Dec) *</span>
            <div className="grid grid-cols-4 gap-2">
              <select
                value={decSign}
                onChange={(e) => setDecSign(e.target.value)}
                className="w-full appearance-none rounded-full border border-gray-300 dark:border-gray-600 bg-transparent dark:bg-transparent px-3 py-2 text-sm"
              >
                <option value="+">+</option>
                <option value="-">-</option>
              </select>
              <input
                required
                type="text"
                inputMode="numeric"
                value={decDegreePart}
                onChange={(e) => setDecDegreePart(e.target.value)}
                placeholder="Deg"
                className="w-full rounded-full border border-gray-300 dark:border-gray-600 bg-transparent dark:bg-transparent px-3 py-2 text-sm"
              />
              <input
                required
                type="text"
                inputMode="numeric"
                value={decMinutePart}
                onChange={(e) => setDecMinutePart(e.target.value)}
                placeholder="Min"
                className="w-full rounded-full border border-gray-300 dark:border-gray-600 bg-transparent dark:bg-transparent px-3 py-2 text-sm"
              />
              <input
                required
                type="text"
                inputMode="decimal"
                value={decSecondPart}
                onChange={(e) => setDecSecondPart(e.target.value)}
                placeholder="Sec"
                className="w-full rounded-full border border-gray-300 dark:border-gray-600 bg-transparent dark:bg-transparent px-3 py-2 text-sm"
              />
            </div>
          </div>
          {sessionType === 'variable_star' && variableStarDurationPick && (
            <div className="sm:col-span-2 grid gap-2">
              <span className="text-sm font-medium text-white">Session duration</span>
              <div
                className="grid w-full gap-2"
                style={{
                  gridTemplateColumns: `repeat(${Math.max(1, Math.ceil(variableStarDurationPick.allOptions.length / 2))}, minmax(0, 1fr))`,
                }}
              >
                {variableStarDurationPick.allOptions.map((h) => {
                  const halfStepsForH = Math.round(h * 2)
                  const enabled =
                    variableStarDurationPick.coordsOk && halfStepsForH <= variableStarDurationPick.starHalfSteps
                  const selected = enabled && variableStarBlockHours === h
                  return (
                    <button
                      key={h}
                      type="button"
                      disabled={!enabled}
                      aria-disabled={!enabled}
                      onClick={() => {
                        if (enabled) {
                          setVariableStarBlockHours(h)
                          setVariableStarDurationUserSelected(true)
                        }
                      }}
                      className={selected ? `${glassPillToggleActive} w-full` : enabled ? `${glassPillToggleIdle} w-full` : glassPillToggleDisabledMd}
                    >
                      {`${h} h`}
                    </button>
                  )
                })}
              </div>
            </div>
          )}
          {sessionType === 'dso' && (
            <div className="sm:col-span-2 grid gap-3">
              <span className="text-sm font-medium text-white">
                Filters *
                {mosaicMode
                  ? ` · ${(mosaicDraft?.panels.find((p) => p.id === selectedMosaicPanelId)?.name ?? `Panel ${selectedMosaicPanelId}`)}`
                  : ''}
              </span>
              <div className="flex flex-wrap gap-2">
                {FILTER_OPTIONS.map((option) => {
                  const selected = filterPlans.some((x) => x.filterName === option.value)
                  return (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => {
                        setFilterPlans((prev) => {
                          const idx = prev.findIndex((x) => x.filterName === option.value)
                          if (idx >= 0) return prev.filter((x) => x.filterName !== option.value)
                          return [...prev, { filterName: option.value, count: '10', exposureSeconds: '' }]
                        })
                      }}
                      className={selected ? glassPillToggleActive : glassPillToggleIdle}
                    >
                      {option.label}
                    </button>
                  )
                })}
              </div>
              {filterPlans.length > 0 && (
                <div className="space-y-2">
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,11rem)_1fr_1fr] sm:items-end">
                    <div className="hidden sm:block" />
                    <div className="text-sm font-medium text-white">Frame Count *</div>
                    <div className="text-sm font-medium text-white">Exposure per Frame (s) *</div>
                  </div>

                  <div className="space-y-2">
                    {filterPlans.map((plan) => {
                      const label =
                        FILTER_OPTIONS.find((o) => o.value === plan.filterName)?.label ?? plan.filterName
                      return (
                        <div
                          key={plan.filterName}
                          className="grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,11rem)_1fr_1fr] sm:items-center"
                        >
                          <button
                            type="button"
                            disabled
                            aria-disabled="true"
                            className={`${glassPillFullWidthMd} opacity-90 cursor-default sm:self-end`}
                          >
                            {label}
                          </button>

                          <input
                            type="text"
                            inputMode="numeric"
                            value={plan.count}
                            onChange={(e) =>
                              setFilterPlans((prev) =>
                                prev.map((x) => (x.filterName === plan.filterName ? { ...x, count: e.target.value } : x))
                              )
                            }
                            className="w-full rounded-full border border-gray-300 dark:border-gray-600 bg-transparent px-3 py-2 text-sm"
                          />

                          <input
                            type="text"
                            inputMode="decimal"
                            value={plan.exposureSeconds}
                            onChange={(e) =>
                              setFilterPlans((prev) =>
                                prev.map((x) =>
                                  x.filterName === plan.filterName ? { ...x, exposureSeconds: e.target.value } : x
                                )
                              )
                            }
                            className="w-full rounded-full border border-gray-300 dark:border-gray-600 bg-transparent px-3 py-2 text-sm"
                          />
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}
            </div>
          )}
          <div className="sm:col-span-2 grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="grid gap-2">
              <span className="text-sm font-medium text-white">Output Type *</span>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => setOutputMode('raw_zip')}
                  className={outputMode === 'raw_zip' ? glassPillToggleActive : glassPillToggleIdle}
                >
                  Raw ZIP
                </button>
                <button
                  type="button"
                  onClick={() => setOutputMode('none')}
                  className={outputMode === 'none' ? glassPillToggleActive : glassPillToggleIdle}
                >
                  None
                </button>
              </div>
            </div>
            <div className="grid gap-2">
              <span className="text-sm font-medium text-white">Camera Temperature</span>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={ambientTempC !== null && ambientTempC > 20}
                  onClick={() => setCameraCoolingTempC(-10)}
                  className={
                    ambientTempC !== null && ambientTempC > 20
                      ? `${glassPillDisabled} px-3 py-2 text-sm`
                      : cameraCoolingTempC === -10
                        ? glassPillToggleActive
                        : glassPillToggleIdle
                  }
                >
                  −10°C
                </button>
                <button
                  type="button"
                  onClick={() => setCameraCoolingTempC(0)}
                  className={cameraCoolingTempC === 0 ? glassPillToggleActive : glassPillToggleIdle}
                >
                  0°C
                </button>
              </div>
            </div>
          </div>
          {submitError && (
            <p className="sm:col-span-2 text-sm text-red-600 dark:text-red-400" role="alert">
              {submitError}
            </p>
          )}
          {submitSuccess && (
            <p className="sm:col-span-2 text-sm text-green-700 dark:text-green-400" role="status">
              {submitSuccess}
            </p>
          )}
          <div className="sm:col-span-2 flex flex-wrap items-center gap-2">
            <button
              type="submit"
              disabled={submitting || !imagingAccess.ok}
              className={`${glassPillMd} disabled:opacity-60`}
            >
              {submitting ? (editingSessionId ? 'Finishing...' : 'Starting...') : editingSessionId ? 'Finish Editing' : 'Start Session'}
            </button>
            <button
              type="button"
              disabled={!imagingAccess.ok}
              onClick={() => {
                if (!imagingAccess.ok) return
                setRunModalError(null)
                setRunModalName('')
                setShowRunRemoteSessionModal(true)
              }}
              className={`${glassPillMd} disabled:opacity-50`}
            >
              Run A Saved Session
            </button>
            <button
              type="button"
              disabled={!canSaveRemoteSessionSpec}
              onClick={() => {
                if (!canSaveRemoteSessionSpec) return
                setSaveModalError(null)
                setSaveModalName(requestName.trim())
                setShowSaveRemoteSessionModal(true)
              }}
              className={`${glassPillMd} disabled:opacity-50`}
            >
              Save Session
            </button>
          </div>
          <p className="sm:col-span-2 text-xs text-gray-500">
            Estimated duration:{' '}
            {sessionType === 'variable_star'
              ? variableStarEstimatedDurationPreviewSeconds == null
                ? '--'
                : formatDurationShort(variableStarEstimatedDurationPreviewSeconds)
              : dsoEstimatedDurationPreviewSeconds == null
                ? '--'
                : formatDurationShort(dsoEstimatedDurationPreviewSeconds)}
          </p>
            </fieldset>
            </form>
            </>
            )}
          </div>
        </section>

  )
}

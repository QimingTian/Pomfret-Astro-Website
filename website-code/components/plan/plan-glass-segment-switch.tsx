'use client'

type SegmentOption<T extends string> = {
  value: T
  label: string
}

type Props<T extends string> = {
  options: SegmentOption<T>[]
  value: T
  onChange: (value: T) => void
  disabled?: boolean
  ariaLabel: string
  /** Min width per segment — identical on every option (matches Atlas / Framing). */
  minWidthRem?: number
  className?: string
}

export function PlanGlassSegmentSwitch<T extends string>({
  options,
  value,
  onChange,
  disabled,
  ariaLabel,
  minWidthRem = 5.5,
  className = '',
}: Props<T>) {
  const index = Math.max(0, options.findIndex((o) => o.value === value))
  return (
    <div
      className={`glass-pill relative inline-flex shrink-0 items-center p-0.5 ${disabled ? 'opacity-60' : ''} ${className}`}
      role="group"
      aria-label={ariaLabel}
    >
      <div
        aria-hidden
        className="glass-pill-active pointer-events-none absolute inset-y-0.5 left-0.5 rounded-full transition-transform duration-300 ease-out"
        style={{
          width: `calc((100% - 4px) / ${options.length})`,
          transform: `translateX(${index * 100}%)`,
        }}
      />
      {options.map((o) => {
        const active = value === o.value
        return (
          <button
            key={o.value}
            type="button"
            disabled={disabled}
            aria-pressed={active}
            onClick={() => onChange(o.value)}
            className={`relative z-[1] flex items-center justify-center rounded-full px-3 py-1.5 text-sm font-medium transition-colors disabled:cursor-not-allowed ${
              active ? 'text-white' : 'glass-pill-idle border-transparent bg-transparent text-white/70 hover:text-white'
            }`}
            style={{ minWidth: `${minWidthRem}rem` }}
          >
            {o.label}
          </button>
        )
      })}
    </div>
  )
}

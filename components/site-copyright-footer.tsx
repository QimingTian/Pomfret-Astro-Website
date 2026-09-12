/** Site-wide proprietary copyright line. */
export function SiteCopyrightFooter({
  className = '',
  compact = false,
  /** Light-on-dark variant for About / auth screens. */
  tone = 'default',
}: {
  className?: string
  /** Tighter padding for auth screens. */
  compact?: boolean
  tone?: 'default' | 'onDark'
}) {
  const year = new Date().getFullYear()
  const onDark = tone === 'onDark'
  return (
    <footer
      className={[
        /* Sit above About’s fixed video (z-0) and other full-bleed layers. */
        'relative z-20',
        onDark
          ? 'border-t border-white/10 bg-[#09090a]'
          : 'border-t border-black/10 bg-white/90 backdrop-blur-md dark:border-white/10 dark:bg-[#09090a]/95',
        compact ? 'py-5' : 'py-7',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
    >
      <p
        className={[
          'mx-auto max-w-[1400px] px-4 text-center text-[11px] leading-relaxed tracking-[0.05em] sm:px-6 sm:text-xs lg:px-10',
          onDark
            ? 'text-white/55'
            : 'text-apple-dark/55 dark:text-[#eee9dc]/55',
        ].join(' ')}
      >
        © {year} Qiming Tian. Pomfret Astro. All rights reserved.
      </p>
    </footer>
  )
}

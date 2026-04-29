'use client'

export default function ThemeToggle() {
  return (
    <button
      className="p-2.5 rounded-full border border-black/10 dark:border-white/15 bg-white/70 dark:bg-white/5 hover:bg-white dark:hover:bg-white/10 transition-all"
      aria-label="Dark mode enabled"
      title="Dark mode enabled"
      disabled
    >
      <svg
        className="w-5 h-5 text-gray-700 dark:text-gray-300"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z"
        />
      </svg>
    </button>
  )
}


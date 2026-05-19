/** Escapes dashboard <main> padding so rules span the viewport width. */
export function AccountFullBleedRule({ className = '' }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={`ml-[calc(50%-50vw)] mr-[calc(50%-50vw)] h-px w-screen bg-black/10 dark:bg-white/10 ${className}`}
    />
  )
}

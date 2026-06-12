export function AccountFullBleedRule({ className = '' }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={`ml-[calc(50%-50vw)] mr-[calc(50%-50vw)] h-px w-screen bg-white/10 ${className}`}
    />
  )
}

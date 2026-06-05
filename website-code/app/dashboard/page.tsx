export default function DashboardPage() {
  return (
    <section className="relative min-h-[calc(100vh-5rem)] overflow-hidden">
      <video
        className="absolute inset-0 h-full w-full object-cover"
        src="/welcome-background.mp4"
        autoPlay
        muted
        loop
        playsInline
        preload="auto"
      />
      <div className="absolute inset-0 bg-black/45" />
      <div className="relative z-10 flex h-full min-h-[calc(100vh-5rem)] items-center justify-center px-6 text-center">
        <h1 className="text-2xl font-semibold text-apple-dark dark:text-white px-8 pt-4 pb-3">
          Welcome To Pomfret Olmsted Observatory
        </h1>
      </div>
    </section>
  )
}

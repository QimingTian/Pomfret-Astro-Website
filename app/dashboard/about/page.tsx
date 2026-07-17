export default function AboutPage() {
  return (
    <div className="pb-8 max-w-3xl lg:-translate-x-3 space-y-6">
      <h1 className="text-2xl font-semibold text-apple-dark dark:text-white">About</h1>
      <div className="space-y-4 text-sm sm:text-base leading-relaxed text-gray-700 dark:text-gray-300">
        <p>
          Pomfret Astro is the remote operations hub for Pomfret Olmsted Observatory — a student-built
          system for autonomous deep-sky imaging and photometry under Pomfret’s night skies.
        </p>
        <p>
          From weather decisions to scientific observations, the observatory is designed to run safely
          and autonomously, collecting data for real research while remaining accessible to students.
        </p>
      </div>
    </div>
  )
}

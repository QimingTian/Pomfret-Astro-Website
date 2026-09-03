function ContactCard({
  name,
  role,
  email,
}: {
  name: string
  role: string
  email?: string
}) {
  return (
    <div className="space-y-1">
      <p className="text-base font-semibold text-white">{name}</p>
      <p className="text-sm text-gray-700 dark:text-gray-300">{role}</p>
      {email ? <p className="text-sm text-gray-700 dark:text-gray-300">{email}</p> : null}
    </div>
  )
}

function PortraitPlaceholder({ label }: { label: string }) {
  return (
    <div
      className="flex h-64 w-full items-center justify-center rounded-lg bg-[#3a3a3e]"
      aria-label={`${label} portrait placeholder`}
      role="img"
    >
      <span className="text-4xl font-medium tracking-tight text-white/35">{label}</span>
    </div>
  )
}

export default function ContactPage() {
  return (
    <div className="pb-8 max-w-3xl lg:-translate-x-3 space-y-8">
      <h1 className="text-2xl font-semibold text-apple-dark dark:text-white">Team</h1>
      <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        <article className="boxed-fields space-y-3">
          <img src="/E_Lake_Joshua.jpg" alt="Joshua Lake" className="h-64 w-full rounded-lg object-cover" />
          <ContactCard
            name="Joshua Lake"
            role="Pomfret Olmsted Observatory Admin"
            email="jlake@pomfret.org"
          />
        </article>
        <article className="boxed-fields space-y-3">
          <img src="/james.jpg" alt="James Tian" className="h-64 w-full rounded-lg object-cover" />
          <ContactCard name="James Tian" role="Pomfret Astro Admin" email="qtian.28@pomfret.org" />
        </article>
        <article className="boxed-fields space-y-3">
          <PortraitPlaceholder label="JO" />
          <ContactCard
            name="Jua Op ’t Einde"
            role="Cygnus Gymnasium Observatory Admin"
            email="jaee@zaam.nl"
          />
        </article>
      </div>
    </div>
  )
}

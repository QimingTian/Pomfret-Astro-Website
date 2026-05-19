export function AccountPageHeader({ username }: { username: string }) {
  return (
    <header className="mb-4">
      <h1 className="text-2xl font-semibold text-apple-dark dark:text-white">{username}</h1>
    </header>
  )
}

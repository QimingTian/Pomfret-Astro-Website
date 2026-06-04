'use client'

import { useId, useState } from 'react'
import type { MemberProfile } from '@/hooks/use-member'

const lineInputClass =
  'w-full bg-transparent border-0 border-b border-gray-600 px-0 py-2.5 text-base text-white placeholder:text-white/50 focus:outline-none focus:border-white/60'

const labelClass = 'mb-1 block text-sm text-white'

const primaryButtonClass =
  'inline-flex w-full items-center justify-center rounded-full border border-white/25 bg-[#151616] px-6 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-[#1b1c1c] disabled:cursor-not-allowed disabled:opacity-50'

const secondaryButtonClass =
  'inline-flex w-full items-center justify-center rounded-full border border-white/25 bg-transparent px-6 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-white/10'

export function MemberAuthPanel({
  onSignedIn,
}: {
  onSignedIn: (user?: MemberProfile) => void | Promise<void>
}) {
  const id = useId()
  const [mode, setMode] = useState<'login' | 'signup'>('login')
  const [login, setLogin] = useState('')
  const [email, setEmail] = useState('')
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  function switchMode(next: 'login' | 'signup') {
    setMode(next)
    setError(null)
    setConfirmPassword('')
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSubmitting(true)
    setError(null)
    try {
      if (mode === 'signup') {
        if (password !== confirmPassword) {
          setError('Passwords do not match.')
          return
        }
        const res = await fetch('/api/auth/signup', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({
            email,
            password,
            firstName: firstName.trim(),
            lastName: lastName.trim(),
            username: username.trim(),
          }),
        })
        const data = await res.json().catch(() => ({}))
        if (!res.ok || data?.ok !== true) {
          setError(typeof data.error === 'string' ? data.error : 'Sign up failed.')
          return
        }
        await onSignedIn(data.user as MemberProfile | undefined)
        return
      }

      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ login: login.trim(), password }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || data?.ok !== true) {
        setError(typeof data.error === 'string' ? data.error : 'Invalid email, username, or password.')
        return
      }
      await onSignedIn(data.user as MemberProfile | undefined)
    } catch {
      setError(mode === 'signup' ? 'Sign up failed.' : 'Log in failed.')
    } finally {
      setSubmitting(false)
    }
  }

  const canSubmit =
    mode === 'login'
      ? Boolean(login.trim() && password)
      : Boolean(
          firstName.trim() &&
            lastName.trim() &&
            username.trim() &&
            email.trim() &&
            password.length >= 8 &&
            confirmPassword.length >= 8 &&
            password === confirmPassword
        )

  return (
    <div className="mx-auto w-full max-w-sm py-10 text-white">
      <p className="mb-8 text-center text-xl font-semibold text-white sm:text-2xl">
        {mode === 'login' ? 'Log In to Continue' : 'Create An Account'}
      </p>
      <form onSubmit={(e) => void handleSubmit(e)} className="space-y-6">
        {mode === 'login' ? (
          <div>
            <label htmlFor={`${id}-login`} className={labelClass}>
              Email or username
            </label>
            <input
              id={`${id}-login`}
              type="text"
              value={login}
              onChange={(e) => setLogin(e.target.value)}
              autoComplete="username"
              required
              className={lineInputClass}
            />
          </div>
        ) : (
          <>
            <div>
              <label htmlFor={`${id}-first`} className={labelClass}>
                First name
              </label>
              <input
                id={`${id}-first`}
                type="text"
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                autoComplete="given-name"
                required
                className={lineInputClass}
              />
            </div>
            <div>
              <label htmlFor={`${id}-last`} className={labelClass}>
                Last name
              </label>
              <input
                id={`${id}-last`}
                type="text"
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                autoComplete="family-name"
                required
                className={lineInputClass}
              />
            </div>
            <div>
              <label htmlFor={`${id}-username`} className={labelClass}>
                Username
              </label>
              <input
                id={`${id}-username`}
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                autoComplete="username"
                required
                className={lineInputClass}
              />
            </div>
            <div>
              <label htmlFor={`${id}-email`} className={labelClass}>
                Email
              </label>
              <input
                id={`${id}-email`}
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
                required
                className={lineInputClass}
              />
            </div>
          </>
        )}
        <div>
          <label htmlFor={`${id}-password`} className={labelClass}>
            {mode === 'signup' ? 'Password (8+ characters)' : 'Password'}
          </label>
          <input
            id={`${id}-password`}
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
            required
            minLength={mode === 'signup' ? 8 : undefined}
            className={lineInputClass}
          />
        </div>
        {mode === 'signup' ? (
          <div>
            <label htmlFor={`${id}-confirm-password`} className={labelClass}>
              Confirm password
            </label>
            <input
              id={`${id}-confirm-password`}
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              autoComplete="new-password"
              required
              minLength={8}
              className={lineInputClass}
            />
          </div>
        ) : null}
        {error ? <p className="text-center text-sm text-white">{error}</p> : null}
        <button type="submit" disabled={submitting || !canSubmit} className={primaryButtonClass}>
          {submitting
            ? mode === 'signup'
              ? 'Creating account…'
              : 'Logging in…'
            : mode === 'signup'
              ? 'Sign Up'
              : 'Log In'}
        </button>
      </form>

      <div className="mt-6 space-y-3">
        <p className="text-center text-sm text-white">
          {mode === 'login' ? 'No account?' : 'Already have an account?'}
        </p>
        <button
          type="button"
          onClick={() => switchMode(mode === 'login' ? 'signup' : 'login')}
          className={secondaryButtonClass}
        >
          {mode === 'login' ? 'Sign Up' : 'Log In'}
        </button>
      </div>
    </div>
  )
}

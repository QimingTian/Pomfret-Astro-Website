'use client'

import { useId, useState } from 'react'
import type { MemberProfile } from '@/hooks/use-member'

import {
  authPrimaryButtonClass,
  authSecondaryButtonClass,
  authLineInputClass,
  authLabelClass,
} from '@/components/auth-ui'

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
            <label htmlFor={`${id}-login`} className={authLabelClass}>
              Email or username
            </label>
            <input
              id={`${id}-login`}
              type="text"
              value={login}
              onChange={(e) => setLogin(e.target.value)}
              autoComplete="username"
              required
              className={authLineInputClass}
            />
          </div>
        ) : (
          <>
            <div>
              <label htmlFor={`${id}-first`} className={authLabelClass}>
                First name
              </label>
              <input
                id={`${id}-first`}
                type="text"
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                autoComplete="given-name"
                required
                className={authLineInputClass}
              />
            </div>
            <div>
              <label htmlFor={`${id}-last`} className={authLabelClass}>
                Last name
              </label>
              <input
                id={`${id}-last`}
                type="text"
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                autoComplete="family-name"
                required
                className={authLineInputClass}
              />
            </div>
            <div>
              <label htmlFor={`${id}-username`} className={authLabelClass}>
                Username
              </label>
              <input
                id={`${id}-username`}
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                autoComplete="username"
                required
                className={authLineInputClass}
              />
            </div>
            <div>
              <label htmlFor={`${id}-email`} className={authLabelClass}>
                Email
              </label>
              <input
                id={`${id}-email`}
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
                required
                className={authLineInputClass}
              />
            </div>
          </>
        )}
        <div>
          <label htmlFor={`${id}-password`} className={authLabelClass}>
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
            className={authLineInputClass}
          />
        </div>
        {mode === 'signup' ? (
          <div>
            <label htmlFor={`${id}-confirm-password`} className={authLabelClass}>
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
              className={authLineInputClass}
            />
          </div>
        ) : null}
        {error ? <p className="text-center text-sm text-white">{error}</p> : null}
        <button type="submit" disabled={submitting || !canSubmit} className={authPrimaryButtonClass}>
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
          className={authSecondaryButtonClass}
        >
          {mode === 'login' ? 'Sign Up' : 'Log In'}
        </button>
      </div>
    </div>
  )
}

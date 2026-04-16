'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import dynamic from 'next/dynamic'

const ThemeToggle = dynamic(() => import('@/components/ThemeToggle'), {
  ssr: false,
})

const CORRECT_PASSWORD = 'VISTAobs'

export default function LoginPage() {
  const [password, setPassword] = useState('')
  const [error, setError] = useState(false)
  const router = useRouter()

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (password === CORRECT_PASSWORD) {
      // Store authentication in sessionStorage
      sessionStorage.setItem('authenticated', 'true')
      router.push('/dashboard')
    } else {
      setError(true)
      setPassword('')
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-white dark:bg-gray-900">
      <div className="absolute top-4 right-4">
        <ThemeToggle />
      </div>
      <div className="w-full max-w-md px-8">
        <div className="text-center mb-12">
          <h1 className="text-4xl font-semibold mb-3 text-apple-dark dark:text-white">Pomfret Astro</h1>
          <p className="text-gray-600 dark:text-gray-400 text-lg">Enter password to continue</p>
        </div>
        
        <form onSubmit={handleSubmit} className="space-y-6">
          <div>
            <input
              type="password"
              value={password}
              onChange={(e) => {
                setPassword(e.target.value)
                setError(false)
              }}
              placeholder="Password"
              className="w-full px-4 py-3 bg-apple-gray dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded-lg text-apple-dark dark:text-white placeholder-gray-500 dark:placeholder-gray-400 focus:outline-none focus:border-apple-blue dark:focus:border-blue-500 focus:ring-1 focus:ring-apple-blue dark:focus:ring-blue-500 transition-colors"
              autoFocus
            />
          </div>
          
          {error && (
            <p className="text-red-600 dark:text-red-400 text-sm text-center">Incorrect password</p>
          )}
          
          <button
            type="submit"
            disabled={!password}
            className="w-full py-3 bg-apple-blue hover:bg-apple-blue-hover disabled:bg-gray-300 dark:disabled:bg-gray-700 disabled:cursor-not-allowed text-white font-medium rounded-lg transition-colors"
          >
            Continue
          </button>
        </form>
      </div>
    </div>
  )
}


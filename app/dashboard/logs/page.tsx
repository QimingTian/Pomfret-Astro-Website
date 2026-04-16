'use client'

import { useState } from 'react'
import { useAppStore } from '@/lib/store'

export default function LogsPage() {
  const store = useAppStore()
  const [selectedModule, setSelectedModule] = useState<string>('all')
  const [selectedLevel, setSelectedLevel] = useState<string | null>(null)
  const [selectedController, setSelectedController] = useState<string>('all')

  const filteredLogs = store.logs.filter((log) => {
    if (selectedModule !== 'all' && log.module !== selectedModule) return false
    if (selectedLevel && log.level !== selectedLevel) return false
    if (selectedController !== 'all' && log.controllerID !== selectedController) return false
    return true
  })

  const exportCSV = () => {
    const header = 'timestamp,controller,module,level,message,extra\n'
    const rows = filteredLogs.map((log) => {
      const ts = log.ts.toISOString()
      const msg = log.message.replace(/"/g, '""')
      const extra = (log.extra || '').replace(/"/g, '""')
      const controller = (log.controllerName || '').replace(/"/g, '""')
      return `"${ts}","${controller}","${log.module}","${log.level}","${msg}","${extra}"`
    })
    const csv = header + rows.join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `observatory-logs-${Date.now()}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="p-8">
      <div className="mb-6">
        <h1 className="text-3xl font-semibold text-apple-dark dark:text-white mb-2">Logs</h1>
      </div>

      <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 overflow-hidden">
        {/* Filters */}
        <div className="p-4 border-b border-gray-200 dark:border-gray-700 bg-apple-gray dark:bg-gray-800">
          <div className="flex gap-4 items-center">
            <select
              value={selectedModule}
              onChange={(e) => setSelectedModule(e.target.value)}
              className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 text-apple-dark dark:text-white"
            >
              <option value="all">All Modules</option>
              <option value="camera">Camera</option>
              <option value="weather">Weather</option>
              <option value="settings">Settings</option>
            </select>

            <select
              value={selectedLevel || 'all'}
              onChange={(e) => setSelectedLevel(e.target.value === 'all' ? null : e.target.value)}
              className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 text-apple-dark dark:text-white"
            >
              <option value="all">All Levels</option>
              <option value="info">Info</option>
              <option value="warn">Warn</option>
              <option value="error">Error</option>
            </select>

            <select
              value={selectedController}
              onChange={(e) => setSelectedController(e.target.value)}
              className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 text-apple-dark dark:text-white"
            >
              <option value="all">All Controllers</option>
              {store.controllers.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>

            <button
              onClick={exportCSV}
              className="ml-auto px-4 py-2 bg-apple-blue text-white rounded-lg text-sm font-medium hover:bg-apple-blue-hover"
            >
              Export CSV
            </button>
          </div>
        </div>

        {/* Logs Table */}
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-apple-gray dark:bg-gray-800">
              <tr>
                <th className="px-4 py-3 text-left text-sm font-semibold text-gray-700 dark:text-gray-300">Time</th>
                <th className="px-4 py-3 text-left text-sm font-semibold text-gray-700 dark:text-gray-300">Controller</th>
                <th className="px-4 py-3 text-left text-sm font-semibold text-gray-700 dark:text-gray-300">Module</th>
                <th className="px-4 py-3 text-left text-sm font-semibold text-gray-700 dark:text-gray-300">Level</th>
                <th className="px-4 py-3 text-left text-sm font-semibold text-gray-700 dark:text-gray-300">Message</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
              {filteredLogs.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-gray-500 dark:text-gray-400">
                    No logs available
                  </td>
                </tr>
              ) : (
                filteredLogs.map((log) => (
                  <tr key={log.id} className="hover:bg-apple-gray dark:hover:bg-gray-700">
                    <td className="px-4 py-3 text-sm text-gray-600 dark:text-gray-400">
                      {log.ts.toLocaleString()}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-600 dark:text-gray-400">
                      {log.controllerName || '—'}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-600 dark:text-gray-400">{log.module}</td>
                    <td className="px-4 py-3 text-sm">
                      <span
                        className={`px-2 py-1 rounded text-xs font-medium ${
                          log.level === 'error'
                            ? 'bg-red-100 dark:bg-red-900 text-red-700 dark:text-red-300'
                            : log.level === 'warn'
                            ? 'bg-yellow-100 dark:bg-yellow-900 text-yellow-700 dark:text-yellow-300'
                            : 'bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300'
                        }`}
                      >
                        {log.level.toUpperCase()}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-900 dark:text-gray-100">{log.message}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

'use client'

import { useState } from 'react'
import { useAppStore } from '@/lib/store'
import type { ControllerConfig } from '@/lib/types'

export default function SettingsPage() {
  const store = useAppStore()
  const [editingId, setEditingId] = useState<string | null>(null)

  const handleAddController = () => {
    const createUUID = () => {
      if (typeof crypto !== 'undefined' && crypto.randomUUID) {
        return crypto.randomUUID()
      }
      return `uuid-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
    }
    
    const newController: ControllerConfig = {
      id: createUUID(),
      name: `Controller ${store.controllers.length + 1}`,
      baseURL: 'http://localhost:8080',
      authToken: undefined,
      roles: ['cameras'],
    }
    store.addController(newController)
    setEditingId(newController.id)
  }

  const handleRemoveController = (id: string) => {
    if (store.controllers.length <= 1) {
      alert('Cannot remove the last controller')
      return
    }
    if (confirm('Are you sure you want to remove this controller?')) {
      store.disconnectController(id)
      store.removeController(id)
    }
  }

  const handleConnect = (id: string) => {
    store.connectController(id)
  }

  const handleDisconnect = (id: string) => {
    store.disconnectController(id)
  }

  const handleUpdate = (id: string, updates: Partial<ControllerConfig>) => {
    store.updateController(id, updates)
  }

  return (
    <div className="p-8">
      <div className="mb-6">
        <h1 className="text-3xl font-semibold text-apple-dark dark:text-white mb-2">Settings</h1>
        <p className="text-gray-600 dark:text-gray-400">Manage camera controllers</p>
      </div>

      <div className="space-y-4">
        {store.controllers.map((controller) => {
          const isConnected = store.connectedControllers.has(controller.id)
          const isEditing = editingId === controller.id

          return (
            <div key={controller.id} className="bg-apple-gray dark:bg-gray-800 rounded-2xl p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-xl font-semibold text-apple-dark dark:text-white">{controller.name}</h2>
                <div className="flex items-center gap-3">
                  <div className="flex items-center gap-2">
                    <div
                      className={`w-2 h-2 rounded-full ${
                        isConnected ? 'bg-green-500' : 'bg-gray-400 dark:bg-gray-600'
                      }`}
                    />
                    <span className="text-sm text-gray-600 dark:text-gray-400">
                      {isConnected ? 'Connected' : 'Disconnected'}
                    </span>
                  </div>
                  {isConnected && (
                    <span className="text-xs text-gray-500 dark:text-gray-500">(auto-refresh every 5s)</span>
                  )}
                </div>
              </div>

              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    Controller Name
                  </label>
                  <input
                    type="text"
                    value={controller.name}
                    onChange={(e) => handleUpdate(controller.id, { name: e.target.value })}
                    className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-apple-dark dark:text-white focus:outline-none focus:border-apple-blue dark:focus:border-blue-500 focus:ring-1 focus:ring-apple-blue dark:focus:ring-blue-500"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    Base URL
                  </label>
                  <input
                    type="text"
                    value={controller.baseURL}
                    onChange={(e) => handleUpdate(controller.id, { baseURL: e.target.value })}
                    placeholder="http://localhost:8080"
                    className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-apple-dark dark:text-white focus:outline-none focus:border-apple-blue dark:focus:border-blue-500 focus:ring-1 focus:ring-apple-blue dark:focus:ring-blue-500"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    Auth Token (optional)
                  </label>
                  <input
                    type="password"
                    value={controller.authToken || ''}
                    onChange={(e) =>
                      handleUpdate(controller.id, {
                        authToken: e.target.value || undefined,
                      })
                    }
                    placeholder="Optional"
                    className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-apple-dark dark:text-white focus:outline-none focus:border-apple-blue dark:focus:border-blue-500 focus:ring-1 focus:ring-apple-blue dark:focus:ring-blue-500"
                  />
                </div>

                <div className="flex gap-3 pt-2">
                  {isConnected ? (
                    <button
                      onClick={() => handleDisconnect(controller.id)}
                      className="px-4 py-2 bg-gray-600 dark:bg-gray-700 text-white rounded-lg font-medium hover:bg-gray-700 dark:hover:bg-gray-600"
                    >
                      Disconnect
                    </button>
                  ) : (
                    <button
                      onClick={() => handleConnect(controller.id)}
                      className="px-4 py-2 bg-apple-blue text-white rounded-lg font-medium hover:bg-apple-blue-hover"
                    >
                      Connect
                    </button>
                  )}

                  {store.controllers.length > 1 && (
                    <button
                      onClick={() => handleRemoveController(controller.id)}
                      className="px-4 py-2 bg-red-600 dark:bg-red-700 text-white rounded-lg font-medium hover:bg-red-700 dark:hover:bg-red-600"
                    >
                      Remove
                    </button>
                  )}
                </div>
              </div>
            </div>
          )
        })}

        <button
          onClick={handleAddController}
          className="w-full py-4 border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-2xl text-gray-600 dark:text-gray-400 font-medium hover:border-apple-blue dark:hover:border-blue-500 hover:text-apple-blue dark:hover:text-blue-400 transition-colors"
        >
          + Add Controller
        </button>
      </div>
    </div>
  )
}

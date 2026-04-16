'use client'

import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { ControllerConfig, SensorsModel, LogEntry, WeatherModel } from './types'
import { APIClient } from './api-client'

interface ControllerState {
  id: string
  name: string
  baseURL: string
  authToken?: string
  roles: string[]
  sensors: SensorsModel
  apiClient: APIClient
}

interface AppState {
  controllers: ControllerState[]
  connectedControllers: Set<string>
  logs: LogEntry[]
  weather: WeatherModel
  selection: 'camera' | 'weather' | 'logs' | 'settings'
  
  // Actions
  addController: (config: ControllerConfig) => void
  removeController: (id: string) => void
  updateController: (id: string, updates: Partial<ControllerConfig>) => void
  connectController: (id: string) => void
  disconnectController: (id: string) => void
  fetchStatus: (id: string) => Promise<void>
  addLog: (entry: Omit<LogEntry, 'id' | 'ts'>) => void
  setWeather: (weather: WeatherModel) => void
  setSelection: (selection: 'camera' | 'weather' | 'logs' | 'settings') => void
}

const createControllerState = (config: ControllerConfig): ControllerState => ({
  id: config.id,
  name: config.name,
  baseURL: config.baseURL,
  authToken: config.authToken,
  roles: config.roles,
  sensors: {
    temperature: undefined,
    humidity: undefined,
    allSkyCam: { connected: false, streaming: false },
  },
  apiClient: new APIClient(config.baseURL, config.authToken),
})

// Helper to create UUID
const createUUID = () => {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID()
  }
  return `uuid-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
}

export const useAppStore = create<AppState>()(
  persist(
    (set, get) => ({
      controllers: [],
      connectedControllers: new Set(),
      logs: [],
      weather: {},
      selection: 'camera',

      addController: (config) => {
        const controller = createControllerState(config)
        set((state) => ({
          controllers: [...state.controllers, controller],
        }))
      },

      removeController: (id) => {
        set((state) => ({
          controllers: state.controllers.filter((c) => c.id !== id),
          connectedControllers: new Set(
            Array.from(state.connectedControllers).filter((cid) => cid !== id)
          ),
        }))
      },

      updateController: (id, updates) => {
        set((state) => ({
          controllers: state.controllers.map((c) => {
            if (c.id === id) {
              const newConfig = { ...c, ...updates }
              return {
                ...newConfig,
                apiClient: new APIClient(newConfig.baseURL, newConfig.authToken),
              }
            }
            return c
          }),
        }))
      },

      connectController: async (id) => {
        const state = get()
        const controller = state.controllers.find((c) => c.id === id)
        if (!controller) return

        set((state) => ({
          connectedControllers: new Set([...Array.from(state.connectedControllers), id]),
        }))

        state.addLog({
          module: 'settings',
          level: 'info',
          message: `Connecting to ${controller.name}...`,
          controllerID: id,
          controllerName: controller.name,
        })

        try {
          await get().fetchStatus(id)
          state.addLog({
            module: 'settings',
            level: 'info',
            message: `Connected to ${controller.name}`,
            controllerID: id,
            controllerName: controller.name,
          })
        } catch (error) {
          state.addLog({
            module: 'settings',
            level: 'error',
            message: `Failed to connect: ${error instanceof Error ? error.message : 'Unknown error'}`,
            controllerID: id,
            controllerName: controller.name,
          })
        }
      },

      disconnectController: (id) => {
        const state = get()
        const controller = state.controllers.find((c) => c.id === id)
        set((state) => {
          const newSet = new Set(state.connectedControllers)
          newSet.delete(id)
          return { connectedControllers: newSet }
        })

        if (controller) {
          state.addLog({
            module: 'settings',
            level: 'info',
            message: `Disconnected from ${controller.name}`,
            controllerID: id,
            controllerName: controller.name,
          })
        }
      },

      fetchStatus: async (id) => {
        const state = get()
        const controller = state.controllers.find((c) => c.id === id)
        if (!controller) return
        
        // Rebuild apiClient if it's missing (e.g., after rehydration)
        if (!controller.apiClient) {
          const updatedController = {
            ...controller,
            apiClient: new APIClient(controller.baseURL, controller.authToken),
          }
          set((state) => ({
            controllers: state.controllers.map((c) => 
              c.id === id ? updatedController : c
            ),
          }))
          // Use the updated controller
          const updatedState = get()
          const updatedCtrl = updatedState.controllers.find((c) => c.id === id)
          if (!updatedCtrl || !updatedCtrl.apiClient) {
            state.addLog({
              module: 'api',
              level: 'error',
              message: 'Failed to initialize API client',
              controllerID: id,
              controllerName: controller.name,
            })
            return
          }
          try {
            const status = await updatedCtrl.apiClient.fetchStatus()
            // Update state with status
            set((state) => ({
              controllers: state.controllers.map((c) => {
                if (c.id === id && status.sensors) {
                  return {
                    ...c,
                    sensors: {
                      temperature: status.sensors.temperature,
                      humidity: status.sensors.humidity,
                      allSkyCam: {
                        connected: status.sensors.allSkyCam?.connected ?? false,
                        streaming: status.sensors.allSkyCam?.streaming ?? false,
                        lastSnapshot: status.sensors.allSkyCam?.lastSnapshot
                          ? new Date(status.sensors.allSkyCam.lastSnapshot)
                          : undefined,
                        fault: status.sensors.allSkyCam?.fault,
                      },
                    },
                  }
                }
                return c
              }),
            }))
            return
          } catch (error) {
            state.addLog({
              module: 'api',
              level: 'error',
              message: `Failed to fetch status: ${error instanceof Error ? error.message : 'Unknown error'}`,
              controllerID: id,
              controllerName: controller.name,
            })
            return
          }
        }

        try {
          const status = await controller.apiClient.fetchStatus()
          
          set((state) => ({
            controllers: state.controllers.map((c) => {
              if (c.id === id && status.sensors) {
                return {
                  ...c,
                  sensors: {
                    temperature: status.sensors.temperature,
                    humidity: status.sensors.humidity,
                    allSkyCam: {
                      connected: status.sensors.allSkyCam?.connected ?? false,
                      streaming: status.sensors.allSkyCam?.streaming ?? false,
                      lastSnapshot: status.sensors.allSkyCam?.lastSnapshot
                        ? new Date(status.sensors.allSkyCam.lastSnapshot)
                        : undefined,
                      fault: status.sensors.allSkyCam?.fault,
                    },
                  },
                }
              }
              return c
            }),
          }))
        } catch (error) {
          state.addLog({
            module: 'api',
            level: 'error',
            message: `Failed to fetch status: ${error instanceof Error ? error.message : 'Unknown error'}`,
            controllerID: id,
            controllerName: controller.name,
          })
        }
      },

      addLog: (entry) => {
        const logEntry: LogEntry = {
          id: createUUID(),
          ts: new Date(),
          ...entry,
        }
        set((state) => ({
          logs: [logEntry, ...state.logs].slice(0, 1000), // Keep last 1000 logs
        }))
      },

      setWeather: (weather) => {
        set({ weather })
      },

      setSelection: (selection) => {
        set({ selection })
      },
    }),
    {
      name: 'pomfret-astro-storage',
      partialize: (state) => ({
        controllers: state.controllers.map((c) => ({
          id: c.id,
          name: c.name,
          baseURL: c.baseURL,
          authToken: c.authToken,
          roles: c.roles,
        })),
      }),
      onRehydrateStorage: () => (state) => {
        // Rebuild controllers with apiClient and sensors (only on client)
        if (typeof window !== 'undefined' && state) {
          try {
            // Rebuild all controllers with apiClient and sensors
            const rebuiltControllers = state.controllers.map((c: any) => {
              // If controller already has apiClient, it's already rebuilt
              if (c.apiClient) return c
              
              // Rebuild controller state from persisted config
              return createControllerState({
                id: c.id,
                name: c.name,
                baseURL: c.baseURL,
                authToken: c.authToken,
                roles: c.roles,
              })
            })
            
            // Update state with rebuilt controllers
            if (rebuiltControllers.some((c: any, i: number) => !state.controllers[i]?.apiClient)) {
              state.controllers = rebuiltControllers
            }
            
            // Add default controller if none exist
            if (state.controllers.length === 0) {
              // Use setTimeout to ensure state is fully hydrated
              setTimeout(() => {
                state.addController({
                  id: createUUID(),
                  name: 'Camera Controller',
                  baseURL: 'http://172.18.1.109:8080',
                  authToken: undefined,
                  roles: ['cameras'],
                })
              }, 0)
            }
          } catch (e) {
            console.error('Failed to rebuild controllers:', e)
          }
        }
      },
    }
  )
)


'use client'

import { useAppStore } from '@/lib/store'
import MJPEGStream from '@/components/MJPEGStream'

export default function CameraPage() {
  const controller = useAppStore((s) => s.controllers.find((c) => c.roles.includes('cameras')))
  const streamURL = controller?.apiClient?.getStreamURL()

  if (!controller) {
    return (
      <div className="flex h-full flex-col lg:-translate-x-3">
        <h1 className="text-2xl font-semibold text-apple-dark dark:text-white mb-4">All Sky Camera</h1>
        <div className="flex-1 pb-8 min-h-[400px]">
          <div className="w-full h-full min-h-[400px] bg-black dark:bg-black rounded-lg overflow-hidden" />
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col lg:-translate-x-3">
      <h1 className="text-2xl font-semibold text-apple-dark dark:text-white mb-4">All Sky Camera</h1>
      <div className="flex-1 pb-8 min-h-0">
        <div className="w-full h-full space-y-3 mt-6">
          <div className="w-full h-full min-h-[420px] max-h-[calc(100vh-16rem)] relative bg-black overflow-hidden rounded-lg">
            <MJPEGStream
              url={streamURL || ''}
              className="absolute inset-0 w-full h-full"
              minimal
              fill
            />
          </div>
          <p className="text-xs text-gray-500 dark:text-gray-400 text-center">
            Powered by the Pomfret Observatory All-Sky Camera System (ZWO ASI662MC &amp; Raspberry Pi).
          </p>
        </div>
      </div>
    </div>
  )
}

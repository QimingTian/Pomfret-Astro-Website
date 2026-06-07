import { useState } from 'react'
import { DashboardLayout, type DashboardTab } from './components/DashboardLayout'
import { AtlasPage, type RemotePrefill } from './pages/AtlasPage'
import { RemotePage } from './pages/RemotePage'
import { SettingsPage } from './pages/SettingsPage'
import { WeatherPage } from './pages/WeatherPage'

function App() {
  const [tab, setTab] = useState<DashboardTab>('weather')
  const [remotePrefill, setRemotePrefill] = useState<RemotePrefill | null>(null)

  return (
    <DashboardLayout tab={tab} onNavigate={setTab}>
      {tab === 'weather' && <WeatherPage />}
      {tab === 'atlas' && (
        <AtlasPage
          onSendToRemote={(prefill) => {
            setRemotePrefill(prefill)
            setTab('remote')
          }}
        />
      )}
      {tab === 'remote' && (
        <RemotePage
          prefill={remotePrefill}
          onPrefillConsumed={() => setRemotePrefill(null)}
        />
      )}
      {tab === 'settings' && <SettingsPage />}
    </DashboardLayout>
  )
}

export default App

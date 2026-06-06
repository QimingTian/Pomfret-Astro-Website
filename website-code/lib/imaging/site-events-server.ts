import { emitLiveEvent } from '@/lib/imaging/live-bus'
import {
  getEmergencyStopPublicState,
} from '@/lib/imaging-emergency-stop'
import {
  getObservatoryMode,
  getObservatoryStatus,
  isObservatoryAgentConnected,
} from '@/lib/observatory-status-store'

export async function emitSiteObservatoryStatus(): Promise<void> {
  const [mode, status] = await Promise.all([getObservatoryMode(), getObservatoryStatus()])
  void emitLiveEvent('site:observatory', { type: 'observatory_status', mode, status })
}

export async function emitSiteEstop(): Promise<void> {
  const agentConnected = await isObservatoryAgentConnected()
  const estop = await getEmergencyStopPublicState(agentConnected)
  void emitLiveEvent('site:estop', {
    type: 'estop',
    agentConnected,
    ...estop,
  })
}

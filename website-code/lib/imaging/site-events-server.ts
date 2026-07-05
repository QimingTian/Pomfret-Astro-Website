import { emitLiveEvent } from '@/lib/imaging/live-bus'
import { getEmergencyStopPublicState } from '@/lib/imaging-emergency-stop'
import { forcePushObservatoryStatusLive, isObservatoryAgentConnected } from '@/lib/observatory-status-store'

export async function emitSiteObservatoryStatus(): Promise<void> {
  await forcePushObservatoryStatusLive()
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

import { personalJson, personalOptions } from '@/lib/personal/route-helpers'

export const runtime = 'nodejs'

const STATION_LATEST_VERSION = process.env.STATION_LATEST_VERSION ?? '0.1.0'
const STATION_RELEASE_CHANNEL = process.env.STATION_RELEASE_CHANNEL ?? 'stable'

export function OPTIONS() {
  return personalOptions()
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ tenantId: string }> }
) {
  const { tenantId } = await context.params
  return personalJson({
    ok: true,
    tenantId,
    latestVersion: STATION_LATEST_VERSION,
    channel: STATION_RELEASE_CHANNEL,
    // Reserved for OTA: releaseNotes, downloadUrl, signature, mandatory
  })
}

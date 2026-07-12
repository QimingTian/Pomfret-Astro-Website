import assert from 'node:assert/strict'
import test from 'node:test'
import {
  END_NIGHT_DISCORD_AFTER_SESSIONS,
  END_NIGHT_DISCORD_DAWN,
  ESTOP_DISCORD_MANUAL,
  ESTOP_DISCORD_WEATHER_SAFETY,
  patchNinaDiscordMessageText,
} from '@/lib/imaging/nina-discord-message'
import {
  estopDiscordMessageForState,
  estopSequenceJson,
  isWeatherSafetyEmergencyStopActor,
} from '@/lib/imaging/session/estop-sequence'

test('patchNinaDiscordMessageText updates Discord Alert instruction', () => {
  const root = {
    Items: {
      $values: [
        {
          $type: 'NINA.DiscordAlert.DiscordAlertSequenceItems.DiscordMessageInstruction, Discord Alert',
          Text: 'old',
        },
      ],
    },
  }
  patchNinaDiscordMessageText(root, 'new message')
  assert.equal(root.Items.$values[0]!.Text, 'new message')
})

test('weather safety actor detection', () => {
  assert.equal(
    isWeatherSafetyEmergencyStopActor({
      requestedByUserId: 'weather-safety-auto',
      requestedByUsername: 'weather-safety-auto',
    }),
    true,
  )
  assert.equal(
    isWeatherSafetyEmergencyStopActor({
      requestedByUserId: 'u1',
      requestedByUsername: 'admin',
    }),
    false,
  )
  assert.equal(estopDiscordMessageForState({ requestedByUsername: 'weather-safety-auto' }), ESTOP_DISCORD_WEATHER_SAFETY)
  assert.equal(estopDiscordMessageForState({ requestedByUsername: 'James' }), ESTOP_DISCORD_MANUAL)
})

test('estopSequenceJson embeds weather vs manual Discord text', () => {
  const weather = JSON.parse(
    estopSequenceJson('estop-1', {
      requestedByUserId: 'weather-safety-auto',
      requestedByUsername: 'weather-safety-auto',
    }),
  ) as { Items: { $values: Array<{ Items?: { $values: Array<{ Text?: string }> } }> } }
  const manual = JSON.parse(estopSequenceJson('estop-2', { requestedByUsername: 'admin' })) as typeof weather

  const texts = (root: typeof weather) => {
    const found: string[] = []
    const walk = (n: unknown) => {
      if (!n || typeof n !== 'object') return
      if (Array.isArray(n)) {
        for (const x of n) walk(x)
        return
      }
      const rec = n as Record<string, unknown>
      if (typeof rec.$type === 'string' && rec.$type.includes('DiscordMessageInstruction') && typeof rec.Text === 'string') {
        found.push(rec.Text)
      }
      for (const v of Object.values(rec)) walk(v)
    }
    walk(root)
    return found
  }

  assert.deepEqual(texts(weather), [ESTOP_DISCORD_WEATHER_SAFETY])
  assert.deepEqual(texts(manual), [ESTOP_DISCORD_MANUAL])
  assert.equal(END_NIGHT_DISCORD_AFTER_SESSIONS, "Tonight's Session Completed.")
  assert.equal(END_NIGHT_DISCORD_DAWN, 'End Night - Dawn')
})

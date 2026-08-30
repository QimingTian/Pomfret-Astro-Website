/**
 * Server-only AsyncLocalStorage bridge for observatory site scoping.
 * Import this from API / Node entrypoints — never from client components.
 */

import { AsyncLocalStorage } from 'node:async_hooks'
import { registerObservatorySiteAls } from '@/lib/observatory-site-scope'
import type { ObservatorySiteId } from '@/lib/observatory-sites'

const als = new AsyncLocalStorage<ObservatorySiteId>()

registerObservatorySiteAls({
  getStore: () => als.getStore(),
  run: (id, fn) => als.run(id, fn),
})

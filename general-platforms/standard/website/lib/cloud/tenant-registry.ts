import { randomBytes, randomUUID } from 'node:crypto'
import { kvGetJson, kvSetJson } from '@/lib/cloud/kv-rest'
import { SITE_URL } from '@/lib/site-config'
import type { ProductPlan } from '@/lib/site-config'

export type PersonalOrderRecord = {
  orderId: string
  plan: ProductPlan
  tenantId: string
  displayName: string
  email: string | null
  memberId: string | null
  promoCode: string | null
  createdAt: string
  downloadToken: string
}

type TenantRegistryRecord = {
  tenantId: string
  displayName: string
  plan: ProductPlan
  createdAt: string
  orderId: string
}

const memorySecrets = new Map<string, string>()
const memoryOrders = new Map<string, PersonalOrderRecord>()
const memoryMemberOrderIndex = new Map<string, string[]>()

function secretKey(tenantId: string): string {
  return `personal-tenant-secret:${tenantId}`
}

function orderKey(orderId: string): string {
  return `personal-order:${orderId}`
}

function registryKey(tenantId: string): string {
  return `personal-tenant-registry:${tenantId}`
}

function memberOrdersKey(memberId: string): string {
  return `borean-member-orders:${memberId}`
}

function generateApiSecret(): string {
  return randomBytes(32).toString('base64url')
}

export async function storeTenantSecret(tenantId: string, secret: string): Promise<void> {
  memorySecrets.set(tenantId, secret)
  await kvSetJson(secretKey(tenantId), { secret })
}

export async function loadTenantSecret(tenantId: string): Promise<string | undefined> {
  if (memorySecrets.has(tenantId)) return memorySecrets.get(tenantId)
  const remote = await kvGetJson<{ secret?: string }>(secretKey(tenantId))
  if (remote?.secret?.trim()) {
    memorySecrets.set(tenantId, remote.secret.trim())
    return remote.secret.trim()
  }
  return undefined
}

export async function tenantExists(tenantId: string): Promise<boolean> {
  return Boolean(await loadTenantSecret(tenantId))
}

async function appendMemberOrder(memberId: string, orderId: string): Promise<void> {
  const key = memberOrdersKey(memberId)
  let orderIds: string[] = []
  if (memoryMemberOrderIndex.has(memberId)) {
    orderIds = [...memoryMemberOrderIndex.get(memberId)!]
  } else {
    const remote = await kvGetJson<{ orderIds?: string[] }>(key)
    orderIds = remote?.orderIds && Array.isArray(remote.orderIds) ? [...remote.orderIds] : []
  }
  if (!orderIds.includes(orderId)) {
    orderIds.unshift(orderId)
    memoryMemberOrderIndex.set(memberId, orderIds)
    await kvSetJson(key, { orderIds })
  }
}

export async function provisionPersonalTenant(input: {
  plan: ProductPlan
  displayName?: string | null
  email?: string | null
  memberId?: string | null
  promoCode?: string | null
}): Promise<{
  order: PersonalOrderRecord
  tenantConfig: {
    tenantId: string
    apiBaseUrl: string
    apiSecret: string
    displayName: string
  }
}> {
  const tenantId = randomUUID()
  const apiSecret = generateApiSecret()
  const orderId = randomUUID()
  const displayName = input.displayName?.trim() || `Personal ${tenantId.slice(0, 8)}`
  const downloadToken = randomBytes(24).toString('base64url')
  const memberId = input.memberId?.trim() || null

  const order: PersonalOrderRecord = {
    orderId,
    plan: input.plan,
    tenantId,
    displayName,
    email: input.email?.trim() || null,
    memberId,
    promoCode: input.promoCode?.trim() || null,
    createdAt: new Date().toISOString(),
    downloadToken,
  }

  const registry: TenantRegistryRecord = {
    tenantId,
    displayName,
    plan: input.plan,
    createdAt: order.createdAt,
    orderId,
  }

  await storeTenantSecret(tenantId, apiSecret)
  memoryOrders.set(orderId, order)
  await kvSetJson(orderKey(orderId), order)
  await kvSetJson(registryKey(tenantId), registry)
  if (memberId) {
    await appendMemberOrder(memberId, orderId)
  }

  return {
    order,
    tenantConfig: {
      tenantId,
      apiBaseUrl: SITE_URL,
      apiSecret,
      displayName,
    },
  }
}

export async function loadOrder(orderId: string): Promise<PersonalOrderRecord | undefined> {
  if (memoryOrders.has(orderId)) return memoryOrders.get(orderId)
  const remote = await kvGetJson<PersonalOrderRecord>(orderKey(orderId))
  if (remote?.orderId) {
    memoryOrders.set(orderId, remote)
    return remote
  }
  return undefined
}

export async function listOrdersForMember(memberId: string): Promise<PersonalOrderRecord[]> {
  const key = memberOrdersKey(memberId)
  let orderIds: string[] = []
  if (memoryMemberOrderIndex.has(memberId)) {
    orderIds = memoryMemberOrderIndex.get(memberId)!
  } else {
    const remote = await kvGetJson<{ orderIds?: string[] }>(key)
    orderIds = remote?.orderIds && Array.isArray(remote.orderIds) ? remote.orderIds : []
    memoryMemberOrderIndex.set(memberId, orderIds)
  }

  const orders: PersonalOrderRecord[] = []
  for (const orderId of orderIds) {
    const order = await loadOrder(orderId)
    if (order) orders.push(order)
  }
  return orders
}

export async function orderAuthorized(orderId: string, token: string | null): Promise<PersonalOrderRecord | undefined> {
  const order = await loadOrder(orderId)
  if (!order) return undefined
  if (!token || token !== order.downloadToken) return undefined
  return order
}

export async function orderOwnedByMember(
  orderId: string,
  memberId: string
): Promise<PersonalOrderRecord | undefined> {
  const order = await loadOrder(orderId)
  if (!order || order.memberId !== memberId) return undefined
  return order
}

export async function tenantConfigForOrder(order: PersonalOrderRecord) {
  const secret = await loadTenantSecret(order.tenantId)
  if (!secret) return undefined
  return {
    tenantId: order.tenantId,
    apiBaseUrl: SITE_URL,
    apiSecret: secret,
    displayName: order.displayName,
  }
}

export async function resolveMemberOrderTenant(orderId: string, memberId: string) {
  const order = await orderOwnedByMember(orderId, memberId)
  if (!order) return null
  const tenantConfig = await tenantConfigForOrder(order)
  if (!tenantConfig) return null
  return { order, tenantConfig }
}

export async function primaryTenantConfigForMember(memberId: string) {
  const orders = await listOrdersForMember(memberId)
  if (orders.length === 0) return null
  return tenantConfigForOrder(orders[0])
}

import crypto from 'crypto'

import { kvEnabled, kvGetJson, kvSetJson } from '@/lib/kv-rest'
import { hashSessionPassword, verifySessionPasswordHash } from '@/lib/session-password'

export type MemberRole = 'member' | 'admin'

export type MemberUser = {
  id: string
  email: string
  passwordHash: string
  firstName: string
  lastName: string
  username: string
  /** @deprecated Legacy field; use username + firstName/lastName */
  displayName?: string
  role: MemberRole
  createdAt: string
  updatedAt: string
}

export type PublicMemberUser = {
  id: string
  email: string
  firstName: string
  lastName: string
  username: string
  role: MemberRole
  createdAt: string
}

const USERS_KEY = 'member-users'
const EMAIL_INDEX_KEY = 'member-email-index'
const USERNAME_INDEX_KEY = 'member-username-index'
const MAX_USERS = 5000
const USERNAME_REGEX = /^[a-zA-Z0-9._-]{3,32}$/

type UsersPayload = { users: MemberUser[] }
type IndexPayload = { index: Record<string, string> }

type GlobalMemberStore = typeof globalThis & {
  __pomfret_member_users__?: MemberUser[]
  __pomfret_member_email_index__?: Record<string, string>
  __pomfret_member_username_index__?: Record<string, string>
}

function memoryUsers(): MemberUser[] {
  const g = globalThis as GlobalMemberStore
  if (!g.__pomfret_member_users__) g.__pomfret_member_users__ = []
  return g.__pomfret_member_users__
}

function memoryEmailIndex(): Record<string, string> {
  const g = globalThis as GlobalMemberStore
  if (!g.__pomfret_member_email_index__) g.__pomfret_member_email_index__ = {}
  return g.__pomfret_member_email_index__
}

function memoryUsernameIndex(): Record<string, string> {
  const g = globalThis as GlobalMemberStore
  if (!g.__pomfret_member_username_index__) g.__pomfret_member_username_index__ = {}
  return g.__pomfret_member_username_index__
}

export function normalizeMemberEmail(email: string): string {
  return email.trim().toLowerCase()
}

export function normalizeMemberUsername(username: string): string {
  return username.trim().toLowerCase()
}

function bootstrapAdminEmails(): Set<string> {
  const configured = process.env.BOOTSTRAP_ADMIN_EMAILS?.trim()
  const raw = configured && configured.length > 0 ? configured : 'qtian.28@pomfret.org'
  return new Set(
    raw
      .split(',')
      .map((e) => normalizeMemberEmail(e))
      .filter(Boolean)
  )
}

function roleForNewUser(email: string): MemberRole {
  return bootstrapAdminEmails().has(normalizeMemberEmail(email)) ? 'admin' : 'member'
}

function hydrateLegacyUser(raw: Record<string, unknown>): MemberUser | null {
  if (
    raw == null ||
    typeof raw.id !== 'string' ||
    typeof raw.email !== 'string' ||
    typeof raw.passwordHash !== 'string' ||
    (raw.role !== 'member' && raw.role !== 'admin')
  ) {
    return null
  }

  const legacyDisplay =
    typeof raw.displayName === 'string' ? raw.displayName.trim() : ''
  const usernameRaw =
    typeof raw.username === 'string' && raw.username.trim()
      ? raw.username.trim()
      : legacyDisplay || raw.email.split('@')[0] || 'user'
  const firstName =
    typeof raw.firstName === 'string' ? raw.firstName.trim() : legacyDisplay.split(/\s+/)[0] ?? ''
  const lastName =
    typeof raw.lastName === 'string'
      ? raw.lastName.trim()
      : legacyDisplay.split(/\s+/).slice(1).join(' ') ?? ''

  return {
    id: raw.id,
    email: normalizeMemberEmail(raw.email),
    passwordHash: raw.passwordHash,
    firstName,
    lastName,
    username: usernameRaw,
    displayName: legacyDisplay || undefined,
    role: raw.role,
    createdAt: typeof raw.createdAt === 'string' ? raw.createdAt : new Date().toISOString(),
    updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : new Date().toISOString(),
  }
}

/** Upgrade legacy accounts when their email is listed in BOOTSTRAP_ADMIN_EMAILS. */
export async function syncBootstrapAdminRole(user: MemberUser): Promise<MemberUser> {
  if (user.role === 'admin') return user
  if (!bootstrapAdminEmails().has(user.email)) return user
  const users = await readUsers()
  const idx = users.findIndex((u) => u.id === user.id)
  if (idx === -1) return user
  const updated: MemberUser = {
    ...users[idx],
    role: 'admin',
    updatedAt: new Date().toISOString(),
  }
  users[idx] = updated
  await writeUsers(users)
  return updated
}

function toPublicUser(u: MemberUser): PublicMemberUser {
  return {
    id: u.id,
    email: u.email,
    firstName: u.firstName,
    lastName: u.lastName,
    username: u.username,
    role: u.role,
    createdAt: u.createdAt,
  }
}

async function readUsers(): Promise<MemberUser[]> {
  if (kvEnabled()) {
    const remote = await kvGetJson<UsersPayload>(USERS_KEY)
    if (remote?.users && Array.isArray(remote.users)) {
      return remote.users
        .map((u) => hydrateLegacyUser(u as unknown as Record<string, unknown>))
        .filter((u): u is MemberUser => u != null)
    }
    return []
  }
  return memoryUsers().map((u) => hydrateLegacyUser(u as unknown as Record<string, unknown>)).filter(Boolean) as MemberUser[]
}

async function writeUsers(users: MemberUser[]): Promise<void> {
  const trimmed = users.length > MAX_USERS ? users.slice(-MAX_USERS) : users
  if (kvEnabled()) {
    await kvSetJson(USERS_KEY, { users: trimmed })
    return
  }
  const g = globalThis as GlobalMemberStore
  g.__pomfret_member_users__ = trimmed
}

async function readEmailIndex(): Promise<Record<string, string>> {
  if (kvEnabled()) {
    const remote = await kvGetJson<IndexPayload>(EMAIL_INDEX_KEY)
    return remote?.index && typeof remote.index === 'object' ? { ...remote.index } : {}
  }
  return { ...memoryEmailIndex() }
}

async function writeEmailIndex(index: Record<string, string>): Promise<void> {
  if (kvEnabled()) {
    await kvSetJson(EMAIL_INDEX_KEY, { index })
    return
  }
  const g = globalThis as GlobalMemberStore
  g.__pomfret_member_email_index__ = index
}

async function readUsernameIndex(): Promise<Record<string, string>> {
  if (kvEnabled()) {
    const remote = await kvGetJson<IndexPayload>(USERNAME_INDEX_KEY)
    return remote?.index && typeof remote.index === 'object' ? { ...remote.index } : {}
  }
  return { ...memoryUsernameIndex() }
}

async function writeUsernameIndex(index: Record<string, string>): Promise<void> {
  if (kvEnabled()) {
    await kvSetJson(USERNAME_INDEX_KEY, { index })
    return
  }
  const g = globalThis as GlobalMemberStore
  g.__pomfret_member_username_index__ = index
}

export async function getMemberById(id: string): Promise<MemberUser | undefined> {
  const users = await readUsers()
  return users.find((u) => u.id === id)
}

export async function getMemberByEmail(email: string): Promise<MemberUser | undefined> {
  const normalized = normalizeMemberEmail(email)
  if (!normalized) return undefined
  const index = await readEmailIndex()
  const id = index[normalized]
  if (id) return getMemberById(id)
  const users = await readUsers()
  return users.find((u) => u.email === normalized)
}

export async function getMemberByUsername(username: string): Promise<MemberUser | undefined> {
  const normalized = normalizeMemberUsername(username)
  if (!normalized) return undefined
  const index = await readUsernameIndex()
  const id = index[normalized]
  if (id) return getMemberById(id)
  const users = await readUsers()
  return users.find((u) => normalizeMemberUsername(u.username) === normalized)
}

export async function createMember(input: {
  email: string
  password: string
  firstName: string
  lastName: string
  username: string
}): Promise<{ ok: true; user: PublicMemberUser } | { ok: false; error: string }> {
  const email = normalizeMemberEmail(input.email)
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { ok: false, error: 'Valid email is required.' }
  }

  const firstName = input.firstName.trim()
  const lastName = input.lastName.trim()
  const username = input.username.trim()
  const usernameKey = normalizeMemberUsername(username)

  if (!firstName) return { ok: false, error: 'First name is required.' }
  if (!lastName) return { ok: false, error: 'Last name is required.' }
  if (!username || !USERNAME_REGEX.test(username)) {
    return {
      ok: false,
      error: 'Username must be 3–32 characters (letters, numbers, ., _, -).',
    }
  }
  if (input.password.length < 8) {
    return { ok: false, error: 'Password must be at least 8 characters.' }
  }

  if (await getMemberByEmail(email)) {
    return { ok: false, error: 'An account with this email already exists.' }
  }
  if (await getMemberByUsername(usernameKey)) {
    return { ok: false, error: 'This username is already taken.' }
  }

  const now = new Date().toISOString()
  const user: MemberUser = {
    id: crypto.randomUUID(),
    email,
    passwordHash: await hashSessionPassword(input.password),
    firstName,
    lastName,
    username,
    role: roleForNewUser(email),
    createdAt: now,
    updatedAt: now,
  }

  const users = await readUsers()
  users.push(user)
  await writeUsers(users)

  const emailIndex = await readEmailIndex()
  emailIndex[email] = user.id
  await writeEmailIndex(emailIndex)

  const usernameIndex = await readUsernameIndex()
  usernameIndex[usernameKey] = user.id
  await writeUsernameIndex(usernameIndex)

  const synced = await syncBootstrapAdminRole(user)
  return { ok: true, user: toPublicUser(synced) }
}

export async function verifyMemberCredentials(
  login: string,
  password: string
): Promise<MemberUser | null> {
  const trimmed = login.trim()
  if (!trimmed) return null

  const user = trimmed.includes('@')
    ? await getMemberByEmail(trimmed)
    : await getMemberByUsername(trimmed)

  if (!user) return null
  const valid = await verifySessionPasswordHash(password, user.passwordHash)
  if (!valid) return null
  return syncBootstrapAdminRole(user)
}

/** @deprecated Use verifyMemberCredentials */
export async function verifyMemberPassword(
  email: string,
  password: string
): Promise<MemberUser | null> {
  return verifyMemberCredentials(email, password)
}

export async function updateMemberPassword(
  userId: string,
  newPassword: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (newPassword.length < 8) {
    return { ok: false, error: 'Password must be at least 8 characters.' }
  }
  const users = await readUsers()
  const idx = users.findIndex((u) => u.id === userId)
  if (idx === -1) return { ok: false, error: 'User not found.' }
  users[idx] = {
    ...users[idx],
    passwordHash: await hashSessionPassword(newPassword),
    updatedAt: new Date().toISOString(),
  }
  await writeUsers(users)
  return { ok: true }
}

export function toPublicMemberUser(user: MemberUser): PublicMemberUser {
  return toPublicUser(user)
}

export function isAdminUser(user: Pick<MemberUser, 'role'> | null | undefined): boolean {
  return user?.role === 'admin'
}

export function memberLevelLabel(role: MemberRole): string {
  return role === 'admin' ? 'Admin' : 'Member'
}

/** Admin directory: profile fields only (no password or hash). */
export type AdminMemberDirectoryEntry = {
  id: string
  firstName: string
  lastName: string
  email: string
  role: MemberRole
}

export async function listMembersForAdminDirectory(): Promise<AdminMemberDirectoryEntry[]> {
  const users = await readUsers()
  return users
    .map((u) => ({
      id: u.id,
      firstName: u.firstName,
      lastName: u.lastName,
      email: u.email,
      role: u.role,
    }))
    .sort((a, b) => a.email.localeCompare(b.email))
}

export async function deleteMemberById(
  actorUserId: string,
  targetUserId: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!targetUserId) return { ok: false, error: 'Member id is required.' }
  if (actorUserId === targetUserId) {
    return { ok: false, error: 'You cannot remove your own account.' }
  }

  const users = await readUsers()
  const target = users.find((u) => u.id === targetUserId)
  if (!target) return { ok: false, error: 'Member not found.' }
  if (target.role === 'admin') {
    return { ok: false, error: 'Administrator accounts cannot be removed here.' }
  }

  const nextUsers = users.filter((u) => u.id !== targetUserId)
  await writeUsers(nextUsers)

  const emailIndex = await readEmailIndex()
  delete emailIndex[target.email]
  await writeEmailIndex(emailIndex)

  const usernameKey = normalizeMemberUsername(target.username)
  const usernameIndex = await readUsernameIndex()
  if (usernameIndex[usernameKey] === targetUserId) {
    delete usernameIndex[usernameKey]
    await writeUsernameIndex(usernameIndex)
  }

  return { ok: true }
}

export async function setMemberAsAdmin(
  targetUserId: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!targetUserId) return { ok: false, error: 'Member id is required.' }

  const users = await readUsers()
  const idx = users.findIndex((u) => u.id === targetUserId)
  if (idx < 0) return { ok: false, error: 'Member not found.' }
  const target = users[idx]!
  if (target.role === 'admin') {
    return { ok: false, error: 'This member is already an administrator.' }
  }

  users[idx] = { ...target, role: 'admin', updatedAt: new Date().toISOString() }
  await writeUsers(users)
  return { ok: true }
}

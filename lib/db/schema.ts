import {
  doublePrecision,
  index,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core'

const tz = { withTimezone: true, mode: 'string' } as const

export const users = pgTable(
  'users',
  {
    id: text('id').primaryKey(),
    email: text('email').notNull(),
    username: text('username').notNull(),
    passwordHash: text('password_hash').notNull(),
    firstName: text('first_name').notNull().default(''),
    lastName: text('last_name').notNull().default(''),
    displayName: text('display_name'),
    role: text('role').notNull(),
    emailVerifiedAt: timestamp('email_verified_at', tz),
    createdAt: timestamp('created_at', tz).notNull(),
    updatedAt: timestamp('updated_at', tz).notNull(),
  },
  (t) => [
    uniqueIndex('users_email_uq').on(t.email),
    uniqueIndex('users_username_uq').on(t.username),
  ]
)

export const memberships = pgTable(
  'memberships',
  {
    userId: text('user_id').notNull(),
    siteId: text('site_id').notNull(),
    /** observatory_admin | observatory_member */
    siteRole: text('site_role').notNull().default('observatory_member'),
    imagingApprovedAt: timestamp('imaging_approved_at', tz),
    imagingRejectedAt: timestamp('imaging_rejected_at', tz),
    updatedAt: timestamp('updated_at', tz).notNull(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.siteId] })]
)

/** Per-site guest access policy (closed | open_direct | open_approval). */
export const sitePolicies = pgTable('site_policies', {
  siteId: text('site_id').primaryKey(),
  guestAccess: text('guest_access').notNull().default('closed'),
  /** Projects longer than this (hours) require admin approval for site members. */
  memberProjectDurationLimitHours: doublePrecision('member_project_duration_limit_hours')
    .notNull()
    .default(30),
  updatedAt: timestamp('updated_at', tz).notNull(),
})

/** Guest approval grants when site_policies.guest_access = open_approval. */
export const guestSiteAccess = pgTable(
  'guest_site_access',
  {
    userId: text('user_id').notNull(),
    siteId: text('site_id').notNull(),
    /** pending | approved | rejected */
    status: text('status').notNull(),
    updatedAt: timestamp('updated_at', tz).notNull(),
    decidedByUserId: text('decided_by_user_id'),
  },
  (t) => [primaryKey({ columns: [t.userId, t.siteId] })]
)

export const imagingRequests = pgTable(
  'imaging_requests',
  {
    id: text('id').primaryKey(),
    siteId: text('site_id').notNull(),
    status: text('status').notNull(),
    userId: text('user_id'),
    target: text('target').notNull(),
    createdAt: timestamp('created_at', tz).notNull(),
    updatedAt: timestamp('updated_at', tz).notNull(),
    document: jsonb('document').notNull(),
  },
  (t) => [index('imaging_requests_site_status_idx').on(t.siteId, t.status)]
)

export const imagingRequestPayloads = pgTable('imaging_request_payloads', {
  id: text('id').primaryKey(),
  siteId: text('site_id').notNull(),
  ninaSequenceJson: text('nina_sequence_json'),
})

export const imagingProjects = pgTable(
  'imaging_projects',
  {
    id: text('id').primaryKey(),
    siteId: text('site_id').notNull(),
    status: text('status').notNull(),
    userId: text('user_id'),
    target: text('target').notNull(),
    createdAt: timestamp('created_at', tz).notNull(),
    updatedAt: timestamp('updated_at', tz).notNull(),
    document: jsonb('document').notNull(),
  },
  (t) => [index('imaging_projects_site_idx').on(t.siteId)]
)

export const sessionBoard = pgTable('session_board', {
  id: text('id').primaryKey(),
  siteId: text('site_id').notNull(),
  status: text('status').notNull(),
  userId: text('user_id'),
  updatedAt: timestamp('updated_at', tz).notNull(),
  document: jsonb('document').notNull(),
})

export const auditLog = pgTable(
  'audit_log',
  {
    id: text('id').primaryKey(),
    siteId: text('site_id').notNull(),
    at: timestamp('at', tz).notNull(),
    kind: text('kind').notNull(),
    message: text('message').notNull(),
    detail: jsonb('detail'),
  },
  (t) => [index('audit_log_site_at_idx').on(t.siteId, t.at)]
)

export const gallerySubmissions = pgTable('gallery_submissions', {
  id: text('id').primaryKey(),
  siteId: text('site_id').notNull(),
  userId: text('user_id').notNull(),
  status: text('status').notNull(),
  createdAt: timestamp('created_at', tz).notNull(),
  document: jsonb('document').notNull(),
})

export const imagingEquipment = pgTable('imaging_equipment', {
  siteId: text('site_id').primaryKey(),
  rigs: jsonb('rigs').notNull(),
  updatedAt: timestamp('updated_at', tz).notNull(),
})

export const adminClosedWindows = pgTable('admin_closed_windows', {
  id: text('id').primaryKey(),
  siteId: text('site_id').notNull(),
  startIso: timestamp('start_iso', tz).notNull(),
  endIso: timestamp('end_iso', tz).notNull(),
  document: jsonb('document').notNull(),
})

export const r2ObjectMap = pgTable(
  'r2_object_map',
  {
    queueId: text('queue_id').notNull(),
    kind: text('kind').notNull(),
    siteId: text('site_id').notNull(),
    objectKey: text('object_key').notNull(),
  },
  (t) => [primaryKey({ columns: [t.kind, t.queueId] })]
)

export const memberSavedSessions = pgTable(
  'member_saved_sessions',
  {
    id: text('id').notNull(),
    userId: text('user_id').notNull(),
    siteId: text('site_id').notNull(),
    name: text('name').notNull(),
    updatedAt: timestamp('updated_at', tz).notNull(),
    document: jsonb('document').notNull(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.id] })]
)

export const memberSessionHistory = pgTable(
  'member_session_history',
  {
    id: text('id').notNull(),
    userId: text('user_id').notNull(),
    siteId: text('site_id').notNull(),
    updatedAt: timestamp('updated_at', tz).notNull(),
    document: jsonb('document').notNull(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.id] })]
)

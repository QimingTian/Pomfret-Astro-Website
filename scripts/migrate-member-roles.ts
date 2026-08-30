/**
 * One-shot migration: multi-site member roles + guest policies.
 *
 * Usage: npx tsx scripts/migrate-member-roles.ts
 *
 * Mapping:
 * - qtian.28@pomfret.org → pomfret_astro_admin
 * - other former admins on pomfret → observatory_admin @ pomfret, system user
 * - jaee@zaam.nl → observatory_admin @ cygnus (pomfret membership demoted to member)
 * - everyone else → observatory_member on existing memberships
 */

import { neon } from '@neondatabase/serverless'

const JAMES = 'qtian.28@pomfret.org'
const JUA = 'jaee@zaam.nl'

function databaseUrl(): string {
  return (
    process.env.DATABASE_URL?.trim() ||
    process.env.POSTGRES_URL?.trim() ||
    process.env.DATABASE_URL_UNPOOLED?.trim() ||
    ''
  )
}

async function main() {
  const url = databaseUrl()
  if (!url) {
    console.error('DATABASE_URL is not configured')
    process.exit(1)
  }
  const sql = neon(url)
  const now = new Date().toISOString()

  console.log('→ schema: memberships.site_role, site_policies, guest_site_access')
  await sql`ALTER TABLE memberships ADD COLUMN IF NOT EXISTS site_role text NOT NULL DEFAULT 'observatory_member'`
  await sql`
    CREATE TABLE IF NOT EXISTS site_policies (
      site_id text PRIMARY KEY,
      guest_access text NOT NULL DEFAULT 'closed',
      updated_at timestamptz NOT NULL
    )
  `
  await sql`
    CREATE TABLE IF NOT EXISTS guest_site_access (
      user_id text NOT NULL,
      site_id text NOT NULL,
      status text NOT NULL,
      updated_at timestamptz NOT NULL,
      decided_by_user_id text,
      PRIMARY KEY (user_id, site_id)
    )
  `

  await sql`
    INSERT INTO site_policies (site_id, guest_access, updated_at)
    VALUES
      ('pomfret', 'closed', ${now}),
      ('cygnus', 'closed', ${now})
    ON CONFLICT (site_id) DO NOTHING
  `

  console.log('→ inventory before')
  const before = await sql`
    SELECT u.email, u.role, m.site_id, m.site_role
    FROM users u
    LEFT JOIN memberships m ON m.user_id = u.id
    ORDER BY u.email, m.site_id
  `
  console.table(before)

  // Ensure every user has at least a pomfret membership (legacy accounts).
  await sql`
    INSERT INTO memberships (user_id, site_id, site_role, imaging_approved_at, imaging_rejected_at, updated_at)
    SELECT
      u.id,
      'pomfret',
      'observatory_member',
      CASE WHEN u.role IN ('admin', 'pomfret_astro_admin') THEN u.created_at ELSE NULL END,
      NULL,
      ${now}
    FROM users u
    WHERE NOT EXISTS (
      SELECT 1 FROM memberships m WHERE m.user_id = u.id AND m.site_id = 'pomfret'
    )
  `

  // Former admins (except James) → Pomfret observatory_admin; system role user.
  await sql`
    UPDATE memberships m
    SET site_role = 'observatory_admin', updated_at = ${now}
    FROM users u
    WHERE m.user_id = u.id
      AND m.site_id = 'pomfret'
      AND lower(u.email) <> ${JAMES}
      AND u.role IN ('admin', 'pomfret_astro_admin')
  `

  await sql`
    UPDATE users
    SET role = 'user', updated_at = ${now}
    WHERE role IN ('admin', 'pomfret_astro_admin')
      AND lower(email) <> ${JAMES}
  `

  // James → Pomfret Astro Admin + pomfret observatory_admin membership.
  await sql`
    UPDATE users
    SET role = 'pomfret_astro_admin', updated_at = ${now}
    WHERE lower(email) = ${JAMES}
  `
  await sql`
    UPDATE memberships m
    SET site_role = 'observatory_admin', updated_at = ${now}
    FROM users u
    WHERE m.user_id = u.id
      AND m.site_id = 'pomfret'
      AND lower(u.email) = ${JAMES}
  `

  // Remaining members stay observatory_member.
  await sql`
    UPDATE memberships
    SET site_role = 'observatory_member', updated_at = ${now}
    WHERE site_role IS NULL OR site_role = ''
  `

  // Jua → Cygnus Observatory Admin; demote Pomfret to member (keep imaging flags).
  const juaRows = await sql`SELECT id, email FROM users WHERE lower(email) = ${JUA}`
  if (juaRows.length === 0) {
    console.warn(`! Jua not found (${JUA}) — skip cygnus admin assignment`)
  } else {
    const juaId = juaRows[0]!.id as string
    await sql`
      UPDATE users SET role = 'user', updated_at = ${now} WHERE id = ${juaId}
    `
    await sql`
      UPDATE memberships
      SET site_role = 'observatory_member', updated_at = ${now}
      WHERE user_id = ${juaId} AND site_id = 'pomfret'
    `
    await sql`
      INSERT INTO memberships (user_id, site_id, site_role, imaging_approved_at, imaging_rejected_at, updated_at)
      VALUES (${juaId}, 'cygnus', 'observatory_admin', ${now}, NULL, ${now})
      ON CONFLICT (user_id, site_id) DO UPDATE
      SET site_role = 'observatory_admin',
          imaging_approved_at = COALESCE(memberships.imaging_approved_at, EXCLUDED.imaging_approved_at),
          imaging_rejected_at = NULL,
          updated_at = ${now}
    `
    console.log(`→ Jua (${JUA}) → cygnus observatory_admin`)
  }

  // Normalize any leftover legacy role labels.
  await sql`
    UPDATE users SET role = 'user', updated_at = ${now}
    WHERE role IN ('member', 'admin') AND lower(email) <> ${JAMES}
  `
  await sql`
    UPDATE users SET role = 'pomfret_astro_admin', updated_at = ${now}
    WHERE lower(email) = ${JAMES}
  `

  console.log('→ inventory after')
  const after = await sql`
    SELECT u.email, u.role AS system_role, m.site_id, m.site_role,
           m.imaging_approved_at IS NOT NULL AS imaging_ok
    FROM users u
    LEFT JOIN memberships m ON m.user_id = u.id
    ORDER BY u.email, m.site_id
  `
  console.table(after)
  console.log('done')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})

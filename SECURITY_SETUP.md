# Pomfret Astro — Security Setup (Operator Checklist)

Complete these steps **before** deploying the security-hardened release to production.

## 1. Vercel Production environment variables

In Vercel → Project → Settings → Environment Variables → **Production**, ensure all are set:

| Variable | Required |
|----------|----------|
| `KV_REST_API_URL` | Yes |
| `KV_REST_API_TOKEN` | Yes |
| `IMAGING_QUEUE_SECRET` | Yes (≥32 random chars) |
| `CRON_SECRET` | Yes |
| `IMAGING_R2_WRITE_SECRET` | Yes |
| `NINA_SESSION_PROGRESS_BASIC_PASSWORD` | Yes |
| `NINA_MOUNT_TELEMETRY_SECRET` (or `NINA_MOUNT_TELEMETRY_BASIC_PASSWORD`) | Yes |
| `R2_ENDPOINT`, `R2_BUCKET`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` | Yes |
| `RESEND_API_KEY`, `IMAGING_MAIL_FROM` | Yes (email verification) |
| `BOOTSTRAP_ADMIN_EMAILS` | Yes (comma-separated `@pomfret.org` admins only) |
| `SITE_URL` or `NEXT_PUBLIC_SITE_URL` | **Yes** (`https://www.pomfretastro.org`) — verification email links and post-verify redirects |

**Rotate** all shared secrets if they were ever committed, logged, or shared. Generate new values with a password manager.

## 2. Observatory Windows PC (`nina_agent.py`)

**Do not put secrets in `nina_agent.py` or commit them to GitHub.** Keep `TOKEN = ""` in the repo.

On the observatory PC only, set **Windows user or system environment variables**:

| Windows env var | Same value as Vercel |
|-----------------|----------------------|
| `IMAGING_QUEUE_SECRET` | `IMAGING_QUEUE_SECRET` |
| `POMFRET_CRON_SECRET` | `CRON_SECRET` |

NINA Ground Station HTTP auth password = Vercel `NINA_SESSION_PROGRESS_BASIC_PASSWORD` (stored in NINA, not in git).

Mount Telemetry plugin **Shared secret** = Vercel `NINA_MOUNT_TELEMETRY_SECRET` (stored in NINA plugin settings, not in git).

Then pull latest code and **restart** `python nina_agent.py` (new shells pick up env vars).

## 3. Resend email domain

1. Verify sending domain for `IMAGING_MAIL_FROM` (SPF/DKIM in Resend dashboard).
2. After deploy, register a test account and confirm the verification email arrives.

## 4. Network isolation

- **Camera service** (`observatory/camera_service.py`): LAN/VPN only — no public port forwarding.
- **Cloudflare R2**: no public bucket policy; access via presigned URLs only.

## 5. Post-deploy verification

Run these checks (replace domain as needed):

```bash
# Must return 401 without Bearer
curl -s -o /dev/null -w "%{http_code}\n" https://www.pomfretastro.org/api/imaging/nina-sequence

# Must return 401
curl -s -o /dev/null -w "%{http_code}\n" -X PATCH \
  -H "Content-Type: application/json" \
  -d '{"status":"completed"}' \
  https://www.pomfretastro.org/api/imaging/queue/00000000-0000-0000-0000-000000000001

# SSRF blocked
curl -s -o /dev/null -w "%{http_code}\n" \
  "https://www.pomfretastro.org/api/noaa-goes?url=http://169.254.169.254/"

# With secret — must return 200
curl -s -o /dev/null -w "%{http_code}\n" \
  -H "Authorization: Bearer YOUR_IMAGING_QUEUE_SECRET" \
  https://www.pomfretastro.org/api/imaging/nina-sequence
```

Manual checks:

- [ ] Weather cloud map loads (no `url=` param needed)
- [ ] Remote page works logged out (read-only, no data deletion on refresh)
- [ ] New signup receives verification email
- [ ] Non-`@pomfret.org` user blocked from imaging until admin approves (Account → All members)
- [ ] `@pomfret.org` user auto-approved after email verify
- [ ] NINA night: agent polls sequence, progress POST, file upload
- [ ] Vercel cron cleanup succeeds at 05:00 UTC (Functions log)

## 6. Backup

- Export env vars to encrypted storage (never commit to git).
- Note current production deployment ID for rollback.

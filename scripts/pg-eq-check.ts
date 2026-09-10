import { kvGetJson } from '@/lib/kv-rest'
import { neon } from '@neondatabase/serverless'

async function main() {
  const sql = neon(process.env.DATABASE_URL!)
  const kv = await kvGetJson<{ rigs?: unknown }>('pomfret:imaging-equipment')
  const pg = ((await sql.query("SELECT rigs FROM imaging_equipment WHERE site_id = 'pomfret'")) as Array<{ rigs: unknown }>)[0]?.rigs
  const kvRigs = Array.isArray(kv?.rigs) ? kv!.rigs : kv
  const slim = (arr: unknown) =>
    Array.isArray(arr)
      ? arr.map((r) => {
          if (!r || typeof r !== 'object') return r
          const o = r as Record<string, unknown>
          return {
            label: o.label,
            fl: o.focalLengthMm,
            px: o.pixelSizeUm,
            w: o.sensorWidthPx,
            h: o.sensorHeightPx,
            rot: o.fieldRotationDeg,
            keys: Object.keys(o).sort(),
          }
        })
      : arr
  console.log(JSON.stringify({ kv: slim(kvRigs), pg: slim(pg) }, null, 2))
}

void main()

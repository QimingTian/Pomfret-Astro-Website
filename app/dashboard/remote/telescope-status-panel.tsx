'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { useAdaptivePoll } from '@/hooks/use-adaptive-poll'
import { OBS_LON_DEG } from '@/lib/target-altitude'
import { finiteOrNull, gemSpinDeltasDeg, localSiderealTimeHours } from '@/lib/mount-gem-angles'

type MountSample = {
  connected?: boolean
  raHours?: number | null
  decDeg?: number | null
  siderealTimeHours?: number | null
  siteLatitudeDeg?: number | null
  altitudeDeg?: number | null
  azimuthDeg?: number | null
  sideOfPier?: string | null
  trackingEnabled?: boolean | null
  receivedAtUtc?: string | null
  clientUtc?: string | null
}

/** glTF Y-up export: Blender north (−Y) becomes +Z; yaw 180° so NCP / north face web −Z (compass N). */
const MODEL_ROOT_YAW_DEG = 180
/**
 * Both ME_RA_SPIN and ME_DEC_SPIN animate about Blender local +Z (disc face-normal).
 * After glTF Y-up + modelRoot yaw 180°, that mechanical axis is Three local +Y
 * (verified: +Y keeps NINA pierWest ⇒ OTA west of pier; −Y inverted the pier side).
 * Hierarchy: RA_SPIN → RA_Disc → UpperHousing → DEC_AXIS → DEC_SPIN → Disc/CW
 */
const BLENDER_Z_IN_GLTF = new THREE.Vector3(0, 1, 0)
const RA_LOCAL_AXIS = BLENDER_Z_IN_GLTF
const DEC_LOCAL_AXIS = BLENDER_Z_IN_GLTF
const TELEMETRY_STALE_MS = 15_000
const MODEL_URL = '/telescope-models/paramount-me.glb?v=me-axes-20260714'

type GemTarget = {
  raDeltaDeg: number
  decDeltaDeg: number
}

function makeStarfieldPoints(): THREE.Points {
  const count = 1800
  const positions = new Float32Array(count * 3)
  const colors = new Float32Array(count * 3)
  let seed = 42
  const rand = () => {
    seed = (seed * 16807) % 2147483647
    return (seed - 1) / 2147483646
  }
  for (let i = 0; i < count; i += 1) {
    // Hemisphere above and around the mount; keep them far so orbit doesn't clip through.
    const u = rand()
    const v = rand()
    const theta = u * Math.PI * 2
    const phi = Math.acos(0.08 + 0.92 * v) // prefer sky dome, sparse near nadir
    const radius = 18 + rand() * 28
    const i3 = i * 3
    positions[i3] = radius * Math.sin(phi) * Math.cos(theta)
    positions[i3 + 1] = radius * Math.cos(phi) * 0.85 + 2.5
    positions[i3 + 2] = radius * Math.sin(phi) * Math.sin(theta)
    const tint = 0.75 + rand() * 0.25
    colors[i3] = tint
    colors[i3 + 1] = tint
    colors[i3 + 2] = 0.9 + rand() * 0.1
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))
  const material = new THREE.PointsMaterial({
    size: 0.08,
    sizeAttenuation: true,
    vertexColors: true,
    transparent: true,
    opacity: 0.9,
    depthWrite: false,
  })
  const points = new THREE.Points(geometry, material)
  points.frustumCulled = false
  return points
}

/** Huge rolling ground; flat around the pier so the mount footing sits cleanly. */
function makeRollingGround(): THREE.Mesh {
  const size = 480
  const segments = 160
  const geometry = new THREE.PlaneGeometry(size, size, segments, segments)
  geometry.rotateX(-Math.PI / 2)
  const pos = geometry.attributes.position
  for (let i = 0; i < pos.count; i += 1) {
    const x = pos.getX(i)
    const z = pos.getZ(i)
    const r = Math.hypot(x, z)
    const flatten = Math.min(1, Math.max(0, (r - 5) / 10))
    const h =
      (Math.sin(x * 0.045) * Math.cos(z * 0.038) * 0.55 +
        Math.sin(x * 0.11 + 0.7) * Math.sin(z * 0.09 + 1.1) * 0.28 +
        Math.sin(x * 0.29 + z * 0.17) * 0.08) *
      flatten
    pos.setY(i, h)
  }
  pos.needsUpdate = true
  geometry.computeVertexNormals()
  const material = new THREE.MeshStandardMaterial({
    color: 0x151912,
    roughness: 0.97,
    metalness: 0.02,
  })
  const mesh = new THREE.Mesh(geometry, material)
  mesh.receiveShadow = true
  return mesh
}

/** Compass pad around the pier — rings + ticks only (no grid). */
function makeCompassPad(): THREE.Mesh {
  const size = 2048
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')
  if (!ctx) {
    return new THREE.Mesh(new THREE.PlaneGeometry(8, 8), new THREE.MeshBasicMaterial({ visible: false }))
  }

  ctx.clearRect(0, 0, size, size)
  const cx = size / 2
  const cy = size / 2
  const rOuter = size * 0.46
  const rInner = size * 0.30

  ctx.strokeStyle = 'rgba(157,164,173,0.9)'
  ctx.lineWidth = 10
  ctx.beginPath()
  ctx.arc(cx, cy, rOuter, 0, Math.PI * 2)
  ctx.stroke()
  ctx.lineWidth = 7
  ctx.beginPath()
  ctx.arc(cx, cy, rInner, 0, Math.PI * 2)
  ctx.stroke()

  for (let i = 0; i < 72; i += 1) {
    const a = (i / 72) * Math.PI * 2
    const longTick = i % 6 === 0
    const r0 = rInner + 24
    const r1 = longTick ? rOuter - 8 : rOuter - 22
    ctx.strokeStyle = longTick ? 'rgba(183,190,200,0.95)' : 'rgba(110,118,128,0.75)'
    ctx.lineWidth = longTick ? 4 : 2
    ctx.beginPath()
    ctx.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0)
    ctx.lineTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1)
    ctx.stroke()
  }

  const texture = new THREE.CanvasTexture(canvas)
  texture.anisotropy = 8
  texture.colorSpace = THREE.SRGBColorSpace
  texture.needsUpdate = true

  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(7.2, 7.2),
    new THREE.MeshStandardMaterial({
      map: texture,
      transparent: true,
      depthWrite: false,
      metalness: 0.05,
      roughness: 0.85,
    })
  )
  mesh.rotation.x = -Math.PI / 2
  mesh.position.y = 0.015
  mesh.receiveShadow = true
  mesh.userData.compassTexture = texture
  return mesh
}

function makeCompassLabelSprite(text: string): THREE.Sprite {
  const c = document.createElement('canvas')
  c.width = 256
  c.height = 256
  const ctx = c.getContext('2d')
  if (ctx) {
    ctx.clearRect(0, 0, c.width, c.height)
    ctx.fillStyle = '#c3cbd6'
    ctx.font = 'italic 900 150px serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(text, c.width / 2, c.height / 2)
  }
  const map = new THREE.CanvasTexture(c)
  map.needsUpdate = true
  const material = new THREE.SpriteMaterial({
    map,
    transparent: true,
    depthWrite: false,
  })
  const sprite = new THREE.Sprite(material)
  sprite.center.set(0.5, 0)
  // ~0.55 m tall labels — sized for a metric pier (~2 m), not the old giant OBJ scene.
  sprite.scale.set(0.55, 0.55, 1)
  return sprite
}

function resolveLstHours(sample: MountSample, serverNowUtc: string | undefined): number | null {
  const fromPlugin = finiteOrNull(sample.siderealTimeHours)
  if (fromPlugin != null) return fromPlugin
  const utc =
    (sample.clientUtc && Date.parse(sample.clientUtc)) ||
    (sample.receivedAtUtc && Date.parse(sample.receivedAtUtc)) ||
    (serverNowUtc && Date.parse(serverNowUtc)) ||
    Date.now()
  if (!Number.isFinite(utc)) return null
  return localSiderealTimeHours(new Date(utc), OBS_LON_DEG)
}

function findObjectByName(root: THREE.Object3D, name: string): THREE.Object3D | null {
  let found: THREE.Object3D | null = null
  root.traverse((obj) => {
    if (!found && obj.name === name) found = obj
  })
  return found
}

function ncpRestTarget(): GemTarget {
  return { raDeltaDeg: 0, decDeltaDeg: 0 }
}

export function TelescopeStatusPanel() {
  const viewportRef = useRef<HTMLDivElement | null>(null)
  const gemTargetRef = useRef<GemTarget>(ncpRestTarget())
  const gemCurrentRef = useRef<GemTarget>(ncpRestTarget())
  const [connected, setConnected] = useState(false)
  const [trackingEnabled, setTrackingEnabled] = useState<boolean | null>(null)
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  const applySample = useCallback((sample: MountSample | null | undefined, serverNowUtc: string | undefined) => {
    if (!mountedRef.current) return
    if (!sample) {
      setConnected(false)
      setTrackingEnabled(null)
      gemTargetRef.current = ncpRestTarget()
      return
    }
    const receivedAtMs = sample.receivedAtUtc ? Date.parse(sample.receivedAtUtc) : NaN
    const serverNowMs = serverNowUtc ? Date.parse(serverNowUtc) : NaN
    const nowMs = Number.isFinite(serverNowMs) ? serverNowMs : Date.now()
    const stale = !Number.isFinite(receivedAtMs) || nowMs - receivedAtMs > TELEMETRY_STALE_MS
    const nowConnected = !stale && sample.connected === true
    setConnected(nowConnected)
    setTrackingEnabled(
      nowConnected ? (typeof sample.trackingEnabled === 'boolean' ? sample.trackingEnabled : null) : null
    )

    const ra = finiteOrNull(sample.raHours)
    const dec = finiteOrNull(sample.decDeg)
    const lst = resolveLstHours(sample, serverNowUtc)
    if (nowConnected && ra != null && dec != null && lst != null) {
      const spins = gemSpinDeltasDeg({
        raHours: ra,
        decDeg: dec,
        siderealTimeHours: lst,
        sideOfPier: sample.sideOfPier,
      })
      gemTargetRef.current = { raDeltaDeg: spins.raDeltaDeg, decDeltaDeg: spins.decDeltaDeg }
    } else {
      gemTargetRef.current = ncpRestTarget()
    }
  }, [])

  useAdaptivePoll('mount', async () => {
    try {
      const res = await fetch('/api/imaging/mount-pointing', { cache: 'no-store' })
      if (!res.ok || !mountedRef.current) return
      const payload = (await res.json()) as {
        ok?: boolean
        sample?: MountSample | null
        serverNowUtc?: string
      }
      if (payload.ok !== true) return
      applySample(payload.sample ?? null, payload.serverNowUtc)
    } catch {
      if (mountedRef.current) applySample(null, undefined)
    }
  })

  useEffect(() => {
    const host = viewportRef.current
    if (!host) return

    // Rural night sky: deep blue-black, not pure void (airglow / twilight remnant).
    const skyColor = new THREE.Color(0x070b14)
    const scene = new THREE.Scene()
    scene.background = skyColor
    scene.fog = new THREE.FogExp2(skyColor.getHex(), 0.018)

    const camera = new THREE.PerspectiveCamera(50, 1, 0.05, 500)
    // Metric model (~2 m pier): tighter south-side view.
    camera.position.set(2.4, 1.85, 4.6)
    camera.lookAt(0, 1.15, 0)

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.setClearColor(skyColor, 1)
    renderer.domElement.style.width = '100%'
    renderer.domElement.style.height = '100%'
    renderer.domElement.style.display = 'block'
    renderer.outputColorSpace = THREE.SRGBColorSpace
    host.appendChild(renderer.domElement)

    const controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping = true
    controls.dampingFactor = 0.08
    controls.rotateSpeed = 0.8
    controls.zoomSpeed = 0.95
    controls.panSpeed = 0.7
    // Free orbit / zoom — no horizon lock; only keep from going inside the pier / into space.
    controls.minDistance = 0.35
    controls.maxDistance = 220
    controls.minPolarAngle = 0
    controls.maxPolarAngle = Math.PI
    controls.target.set(0, 1.15, 0)
    controls.update()

    const hemi = new THREE.HemisphereLight('#f1f5ff', '#1a1c20', 0.95)
    scene.add(hemi)
    const key = new THREE.DirectionalLight('#ffffff', 1.25)
    key.position.set(4, 7, 3)
    scene.add(key)
    const fill = new THREE.DirectionalLight('#8ea2cf', 0.55)
    fill.position.set(-4, 3.5, -3)
    scene.add(fill)

    const stars = makeStarfieldPoints()
    scene.add(stars)

    const ground = makeRollingGround()
    scene.add(ground)

    const compass = makeCompassPad()
    scene.add(compass)

    const labelR = 3.2
    const labelY = 0.06
    const labelN = makeCompassLabelSprite('N')
    labelN.position.set(0, labelY, -labelR)
    scene.add(labelN)
    const labelS = makeCompassLabelSprite('S')
    labelS.position.set(0, labelY, labelR)
    scene.add(labelS)
    const labelW = makeCompassLabelSprite('W')
    labelW.position.set(-labelR, labelY, 0)
    scene.add(labelW)
    const labelE = makeCompassLabelSprite('E')
    labelE.position.set(labelR, labelY, 0)
    scene.add(labelE)

    const modelRoot = new THREE.Group()
    modelRoot.rotation.y = THREE.MathUtils.degToRad(MODEL_ROOT_YAW_DEG)
    scene.add(modelRoot)

    const raRestQuat = new THREE.Quaternion()
    const decRestQuat = new THREE.Quaternion()
    const raDeltaQuat = new THREE.Quaternion()
    const decDeltaQuat = new THREE.Quaternion()
    let raSpin: THREE.Object3D | null = null
    let decSpin: THREE.Object3D | null = null
    let missingNodesLogged = false
    let disposed = false

    const loader = new GLTFLoader()
    loader.load(
      MODEL_URL,
      (gltf) => {
        if (disposed) return
        const model = gltf.scene
        model.traverse((child) => {
          const mesh = child as THREE.Mesh
          if (mesh.isMesh) {
            mesh.castShadow = true
            mesh.receiveShadow = true
          }
        })
        modelRoot.add(model)

        raSpin = findObjectByName(model, 'ME_RA_SPIN')
        decSpin = findObjectByName(model, 'ME_DEC_SPIN')
        if (!raSpin || !decSpin) {
          if (!missingNodesLogged) {
            missingNodesLogged = true
            console.warn('[TelescopeStatus] GLB missing ME_RA_SPIN / ME_DEC_SPIN — frozen at rest')
          }
          return
        }
        // Hierarchy is authored in Blender:
        // RA_SPIN → RA_Disc → UpperHousing → DEC_AXIS → DEC_SPIN → Disc/CW
        raRestQuat.copy(raSpin.quaternion)
        decRestQuat.copy(decSpin.quaternion)
      },
      undefined,
      (err) => {
        console.warn('[TelescopeStatus] Failed to load paramount-me.glb', err)
      }
    )

    let raf = 0
    const resize = () => {
      const w = host.clientWidth
      const h = host.clientHeight
      if (w <= 0 || h <= 0) return
      renderer.setSize(w, h, true)
      camera.aspect = w / h
      camera.updateProjectionMatrix()
    }
    resize()
    const ro = new ResizeObserver(resize)
    ro.observe(host)

    const animate = () => {
      const t = gemTargetRef.current
      const c = gemCurrentRef.current
      c.raDeltaDeg += (t.raDeltaDeg - c.raDeltaDeg) * 0.1
      c.decDeltaDeg += (t.decDeltaDeg - c.decDeltaDeg) * 0.1

      if (raSpin) {
        raDeltaQuat.setFromAxisAngle(RA_LOCAL_AXIS, THREE.MathUtils.degToRad(c.raDeltaDeg))
        raSpin.quaternion.copy(raRestQuat).multiply(raDeltaQuat)
      }
      if (decSpin) {
        decDeltaQuat.setFromAxisAngle(DEC_LOCAL_AXIS, THREE.MathUtils.degToRad(c.decDeltaDeg))
        decSpin.quaternion.copy(decRestQuat).multiply(decDeltaQuat)
      }

      controls.update()
      renderer.render(scene, camera)
      raf = window.requestAnimationFrame(animate)
    }
    animate()

    return () => {
      window.cancelAnimationFrame(raf)
      disposed = true
      ro.disconnect()
      controls.dispose()
      stars.geometry.dispose()
      ;(stars.material as THREE.PointsMaterial).dispose()
      ground.geometry.dispose()
      ;(ground.material as THREE.MeshStandardMaterial).dispose()
      const compassMap = compass.userData.compassTexture as THREE.CanvasTexture | undefined
      compassMap?.dispose()
      compass.geometry.dispose()
      ;(compass.material as THREE.MeshStandardMaterial).dispose()
      renderer.dispose()
      scene.traverse((obj) => {
        if (obj === stars || obj === ground || obj === compass) return
        const mesh = obj as THREE.Mesh
        if (mesh.geometry) mesh.geometry.dispose()
        const mat = mesh.material
        if (Array.isArray(mat)) mat.forEach((m) => m.dispose())
        else if (mat) mat.dispose()
      })
      if (renderer.domElement.parentElement === host) host.removeChild(renderer.domElement)
    }
  }, [])

  return (
    <div className="bg-transparent p-3">
      <div ref={viewportRef} className="h-[24rem] w-full overflow-hidden rounded-md lg:h-[26rem]" />
      <p className="mt-2 text-center text-sm">
        <span className="text-white">Telescope: </span>
        <span className={connected ? 'text-green-400' : 'text-red-400'}>
          {connected ? 'Connected' : 'Disconnected'}
        </span>
        <span className="text-white"> | Tracking: </span>
        <span className={trackingEnabled ? 'text-green-400' : 'text-red-400'}>
          {trackingEnabled == null ? 'Unknown' : trackingEnabled ? 'Enabled' : 'Stopped'}
        </span>
      </p>
    </div>
  )
}

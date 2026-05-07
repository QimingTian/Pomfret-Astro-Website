'use client'

import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'

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
}

// In this scene, north is defined towards the camera direction (+Z on the ground plane).
const WORLD_NORTH_Y_OFFSET_DEG = 180
const POMFRET_SITE = {
  latitudeDeg: 41.9,
  longitudeDeg: -71.9,
}
const POLAR_ALIGNMENT_X_DEG = 40
const WEBSITE_Y_OFFSET_DEG = -90
const WORLD_COMPASS_ROTATION_DEG = 0
const TELEMETRY_STALE_MS = 10_000
const DISCONNECTED_POINTING = {
  // North celestial pole for Pomfret: due North at local latitude altitude.
  altDeg: POMFRET_SITE.latitudeDeg,
  azDeg: 0,
}

function finiteOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function normalize360(v: number): number {
  let n = v
  while (n < 0) n += 360
  while (n >= 360) n -= 360
  return n
}
function clampAltitude(deg: number): number {
  if (deg < -10) return -10
  if (deg > 90) return 90
  return deg
}

function telescopeInfoToPoint3D(sample: MountSample): { x: number; y: number; z: number } | null {
  const ra = finiteOrNull(sample.raHours)
  const dec = finiteOrNull(sample.decDeg)
  const sidereal = finiteOrNull(sample.siderealTimeHours)
  const siteLat = finiteOrNull(sample.siteLatitudeDeg) ?? POMFRET_SITE.latitudeDeg
  if (ra == null || dec == null || sidereal == null) return null

  const xOffset = -90
  const yOffset = -90
  const elevation = -Math.abs(siteLat)
  let adjustedDec = 180 - dec
  const hourAngleDeg = normalize360((sidereal - ra) * 15.0)
  let adjustedHourAngleDeg = hourAngleDeg

  const sop = (sample.sideOfPier ?? '').toLowerCase()
  const hasKnownPier = sop === 'pierwest' || sop === 'piereast'
  const useWestCoordinates = hasKnownPier ? sop === 'pierwest' : hourAngleDeg >= 180
  if (useWestCoordinates) {
    adjustedHourAngleDeg -= 180
    adjustedDec = dec
  }
  adjustedDec = siteLat > 0 ? adjustedDec : -adjustedDec
  return { x: adjustedDec + xOffset, y: adjustedHourAngleDeg + yOffset, z: elevation }
}

function makeGroundTexture(): THREE.CanvasTexture {
  const size = 2048
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')
  if (!ctx) return new THREE.CanvasTexture(canvas)

  // Transparent ground background; draw only grid/compass lines and labels.
  ctx.clearRect(0, 0, size, size)
  ctx.strokeStyle = 'rgba(55,60,68,0.55)'
  ctx.lineWidth = 2
  const step = size / 8
  for (let i = 0; i <= 8; i += 1) {
    const p = i * step
    ctx.beginPath()
    ctx.moveTo(p, 0)
    ctx.lineTo(p, size)
    ctx.stroke()
    ctx.beginPath()
    ctx.moveTo(0, p)
    ctx.lineTo(size, p)
    ctx.stroke()
  }

  const cx = size / 2
  const cy = size / 2
  const rOuter = size * 0.26
  const rInner = size * 0.17
  ctx.strokeStyle = '#9da4ad'
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
    const r0 = rInner + 20
    const r1 = longTick ? rOuter - 7 : rOuter - 18
    ctx.strokeStyle = longTick ? '#b7bec8' : '#6e7680'
    ctx.lineWidth = longTick ? 4 : 2
    ctx.beginPath()
    ctx.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0)
    ctx.lineTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1)
    ctx.stroke()
  }

  const texture = new THREE.CanvasTexture(canvas)
  texture.anisotropy = 8
  // Use default texture orientation to avoid mirrored-looking ground labels.
  texture.flipY = true
  texture.center.set(0.5, 0.5)
  texture.rotation = THREE.MathUtils.degToRad(WORLD_COMPASS_ROTATION_DEG)
  texture.needsUpdate = true
  return texture
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
  // Anchor on bottom edge so labels sit above the ground plane.
  sprite.center.set(0.5, 0)
  sprite.scale.set(12, 12, 1)
  return sprite
}

export function TelescopeStatusPanel() {
  const viewportRef = useRef<HTMLDivElement | null>(null)
  const targetEulerRef = useRef({ x: 0, y: 0, z: 0 })
  const currentEulerRef = useRef({ x: 0, y: 0, z: 0 })
  const opticalTargetRef = useRef({ alt: 0, az: 0 })
  const pierRollRef = useRef(0)
  const [connected, setConnected] = useState(false)
  const [trackingEnabled, setTrackingEnabled] = useState<boolean | null>(null)

  useEffect(() => {
    let mounted = true
    const load = async () => {
      try {
        const res = await fetch(`/api/imaging/mount-pointing?_=${Date.now()}`, { cache: 'no-store' })
        const data = (await res.json().catch(() => null)) as { ok?: boolean; sample?: MountSample | null } | null
        if (!mounted || !data?.ok || !data.sample) {
          setConnected(false)
          setTrackingEnabled(null)
          opticalTargetRef.current = { alt: DISCONNECTED_POINTING.altDeg, az: DISCONNECTED_POINTING.azDeg }
          // Disconnected parking pose: upright north-facing branch (flipped side).
          pierRollRef.current = Math.PI
          return
        }
        const sample = data.sample
        const receivedAtMs = sample.receivedAtUtc ? Date.parse(sample.receivedAtUtc) : NaN
        const stale = !Number.isFinite(receivedAtMs) || Date.now() - receivedAtMs > TELEMETRY_STALE_MS
        const isConnected = !stale && sample.connected === true
        setConnected(isConnected)
        setTrackingEnabled(isConnected ? (typeof sample.trackingEnabled === 'boolean' ? sample.trackingEnabled : null) : null)
        const alt = finiteOrNull(sample.altitudeDeg)
        const az = finiteOrNull(sample.azimuthDeg)
        if (isConnected && alt != null && az != null) {
          opticalTargetRef.current = { alt: clampAltitude(alt), az: normalize360(az) }
          const sop = (sample.sideOfPier ?? '').toLowerCase()
          // SideOfPier affects which side of the mount the OTA sits on,
          // while keeping optical-axis direction unchanged.
          pierRollRef.current = sop === 'piereast' ? 0 : Math.PI
        } else {
          opticalTargetRef.current = { alt: DISCONNECTED_POINTING.altDeg, az: DISCONNECTED_POINTING.azDeg }
          // Disconnected parking pose: upright north-facing branch (flipped side).
          pierRollRef.current = Math.PI
        }

        // Keep mount body in a stable polar-aligned pose.
        targetEulerRef.current = {
          x: POLAR_ALIGNMENT_X_DEG,
          y: WEBSITE_Y_OFFSET_DEG,
          z: 0,
        }
      } catch {
        if (mounted) {
          setConnected(false)
          setTrackingEnabled(null)
          opticalTargetRef.current = { alt: DISCONNECTED_POINTING.altDeg, az: DISCONNECTED_POINTING.azDeg }
          // Disconnected parking pose: upright north-facing branch (flipped side).
          pierRollRef.current = Math.PI
        }
      }
    }

    void load()
    const id = window.setInterval(load, 1500)
    return () => {
      mounted = false
      window.clearInterval(id)
    }
  }, [])

  useEffect(() => {
    const host = viewportRef.current
    if (!host) return

    const scene = new THREE.Scene()
    scene.background = null

    const camera = new THREE.PerspectiveCamera(62, 1, 0.1, 900)
    // Keep the same distance/height, look from South side (towards North).
    camera.position.set(0, 36, -74)
    camera.lookAt(0, 0, 0)

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.setClearColor(0x000000, 0)
    renderer.domElement.style.width = '100%'
    renderer.domElement.style.height = '100%'
    renderer.domElement.style.display = 'block'
    host.appendChild(renderer.domElement)
    const controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping = true
    controls.dampingFactor = 0.08
    controls.rotateSpeed = 0.8
    controls.zoomSpeed = 0.95
    controls.panSpeed = 0.85
    controls.minDistance = 20
    controls.maxDistance = 280
    controls.maxPolarAngle = Math.PI / 2 - 0.01
    controls.target.set(0, 12, 0)
    controls.update()

    const hemi = new THREE.HemisphereLight('#f1f5ff', '#111318', 1.05)
    scene.add(hemi)
    const key = new THREE.DirectionalLight('#ffffff', 1.35)
    key.position.set(46, 64, 30)
    scene.add(key)
    const fill = new THREE.DirectionalLight('#8ea2cf', 0.6)
    fill.position.set(-56, 32, -46)
    scene.add(fill)

    const groundTexture = makeGroundTexture()
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(170, 170),
      new THREE.MeshStandardMaterial({
        map: groundTexture,
        transparent: true,
        metalness: 0.06,
        roughness: 0.93,
      })
    )
    ground.rotation.x = -Math.PI / 2
    ground.position.y = 0
    scene.add(ground)

    // Compass labels as sprites avoid "backside mirrored text" on the ground plane.
    const labelR = 60
    const labelY = 0.35
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

    const pillarHeight = 16
    const pillar = new THREE.Mesh(
      new THREE.CylinderGeometry(1.7, 2.1, pillarHeight, 24),
      new THREE.MeshStandardMaterial({ color: '#f4f5f7', metalness: 0.24, roughness: 0.3 })
    )
    // Cylinder center sits at half height, so base touches ground (y=0).
    pillar.position.set(0, pillarHeight / 2, 0)
    scene.add(pillar)

    const modelRoot = new THREE.Group()
    // Rotation pivot is fixed at pillar top center.
    modelRoot.position.set(0, pillarHeight, 0)
    scene.add(modelRoot)

    // Match Point3D transform order around the same pivot:
    // Rotate X (axis 1,0,2000) -> Rotate Y (0,1,0) -> Rotate Z (2000,0,1).
    const axisXGroup = new THREE.Group()
    const axisYGroup = new THREE.Group()
    const axisZGroup = new THREE.Group()
    const pointingGroup = new THREE.Group()
    modelRoot.add(axisXGroup)
    axisXGroup.add(axisYGroup)
    axisYGroup.add(axisZGroup)
    axisZGroup.add(pointingGroup)
    const point3dAxisX = new THREE.Vector3(1, 0, 2000).normalize()
    const point3dAxisY = new THREE.Vector3(0, 1, 0).normalize()
    const point3dAxisZ = new THREE.Vector3(2000, 0, 1).normalize()
    const localOpticalAxisDir = new THREE.Vector3(0, 1, 0)

    const objLoader = new OBJLoader()
    let disposed = false

    fetch('/api/imaging/point3d-model?model=Refractor.obj', { cache: 'force-cache' })
      .then((r) => (r.ok ? r.text() : Promise.reject(new Error('model-load-failed'))))
      .then((text) => {
        if (disposed) return
        const obj = objLoader.parse(text)
        obj.traverse((child) => {
          if (child instanceof THREE.Mesh) {
            child.castShadow = true
            child.receiveShadow = true
            child.material = new THREE.MeshStandardMaterial({
              color: '#f4f5f7',
              metalness: 0.24,
              roughness: 0.3,
            })
          }
        })
        // precise=true: expand from transformed vertices (not geometry.boundingBox × matrix).
        // Default path differs slightly between Chrome & Safari when two AABB edges are nearly
        // equal, so the inferred optical axis flips only in Chrome.
        const box = new THREE.Box3().setFromObject(obj, true)
        const size = new THREE.Vector3()
        box.getSize(size)
        const targetSpan = 26
        const maxDim = Math.max(size.x, size.y, size.z) || 1
        const scale = targetSpan / maxDim
        obj.scale.setScalar(scale)
        // Static model alignment:
        // - Y 180deg: correct forward/backward orientation.
        // - Z 180deg: roll tube so diagonal mirror (tail) stays on the correct side.
        obj.rotation.set(0, Math.PI, Math.PI)
        // Point3D rotates around a fixed model-space pivot close to the RA/DEC shaft center.
        // Keep exactly one pivot so telescope + counterweight bar stay anchored to the pillar top.
        const point3dPivot = new THREE.Vector3(0, -102, 525)
        const transformedPivot = point3dPivot.clone().multiplyScalar(scale).applyEuler(obj.rotation)
        obj.position.copy(transformedPivot.multiplyScalar(-1))

        pointingGroup.add(obj)

        // Build optical axis in telescope local space and keep it attached to the model.
        obj.updateMatrixWorld(true)
        const opticalBox = new THREE.Box3().setFromObject(obj, true)
        const opticalSize = new THREE.Vector3()
        const opticalCenter = new THREE.Vector3()
        opticalBox.getSize(opticalSize)
        opticalBox.getCenter(opticalCenter)
        const axisCandidates = [
          { axis: new THREE.Vector3(1, 0, 0), span: opticalSize.x },
          { axis: new THREE.Vector3(0, 1, 0), span: opticalSize.y },
          { axis: new THREE.Vector3(0, 0, 1), span: opticalSize.z },
        ]
        axisCandidates.sort((a, b) => b.span - a.span)
        localOpticalAxisDir.copy(axisCandidates[0].axis).normalize()
        const opticalAxisLength = Math.max(axisCandidates[0].span * 1.12, 8)
        const halfLen = opticalAxisLength / 2
        const start = opticalCenter.clone().addScaledVector(localOpticalAxisDir, -halfLen)
        const end = opticalCenter.clone().addScaledVector(localOpticalAxisDir, halfLen)

        // Keep fixed camera preset; do not auto-fit camera.
        camera.updateProjectionMatrix()
      })
      .catch(() => {
        // No-op: leave empty viewport if model is unavailable.
      })

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
      const t = targetEulerRef.current
      const c = currentEulerRef.current
      c.x += (t.x - c.x) * 0.08
      c.y += (t.y - c.y) * 0.08
      c.z += (t.z - c.z) * 0.08
      axisXGroup.setRotationFromAxisAngle(point3dAxisX, THREE.MathUtils.degToRad(c.x))
      axisYGroup.setRotationFromAxisAngle(point3dAxisY, THREE.MathUtils.degToRad(c.y))
      axisZGroup.setRotationFromAxisAngle(point3dAxisZ, THREE.MathUtils.degToRad(c.z))

      const opt = opticalTargetRef.current
      const azRad = THREE.MathUtils.degToRad(opt.az)
      const altRad = THREE.MathUtils.degToRad(opt.alt)
      const horiz = Math.cos(altRad)
      const targetDir = new THREE.Vector3(
        Math.sin(azRad) * horiz, // East (+X)
        Math.sin(altRad), // Up (+Y)
        -Math.cos(azRad) * horiz // North (-Z) for current ground/compass orientation
      ).normalize()
      const parentWorldQ = new THREE.Quaternion()
      axisZGroup.getWorldQuaternion(parentWorldQ)
      const targetInParent = targetDir.clone().applyQuaternion(parentWorldQ.clone().invert()).normalize()
      const desiredQ = new THREE.Quaternion().setFromUnitVectors(localOpticalAxisDir, targetInParent)
      const pierRollQ = new THREE.Quaternion().setFromAxisAngle(localOpticalAxisDir, pierRollRef.current)
      desiredQ.multiply(pierRollQ)
      pointingGroup.quaternion.slerp(desiredQ, 0.12)

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
      groundTexture.dispose()
      renderer.dispose()
      scene.traverse((obj) => {
        const mesh = obj as THREE.Mesh
        if (mesh.geometry) mesh.geometry.dispose()
        const mat = mesh.material
        if (Array.isArray(mat)) {
          mat.forEach((m) => m.dispose())
        } else if (mat) {
          mat.dispose()
        }
      })
      host.removeChild(renderer.domElement)
    }
  }, [])

  return (
    <div className="bg-transparent p-3">
      <div ref={viewportRef} className="h-[24rem] w-full overflow-hidden rounded-md lg:h-[26rem]" />
      <p className="mt-2 text-center text-sm">
        <span className="text-white">Telescope: </span>
        <span className={connected ? 'text-green-400' : 'text-red-400'}>{connected ? 'Connected' : 'Disconnected'}</span>
        <span className="text-white"> | Tracking: </span>
        <span className={trackingEnabled ? 'text-green-400' : 'text-red-400'}>
          {trackingEnabled == null ? 'Unknown' : trackingEnabled ? 'Enabled' : 'Stopped'}
        </span>
      </p>
    </div>
  )
}
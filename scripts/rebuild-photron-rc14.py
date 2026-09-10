"""
Rebuild RC14 as iOptron Photron RC14-Truss (6116) replica.

Official specs (iOptron 611X manual):
  aperture 355mm, secondary 150mm, obstruction 166mm
  tube length 960mm, tube diameter 533mm
  backfocus 290.2mm from rear support plate
  carbon Serrurier truss, dual Losmandy bars, 3 rear fans

Visual from official photos 6116-2/3/4:
  octagonal CNC rings with stadium cutouts
  3 rings (rear / mid / front)
  4-vane spider in + orientation
  silver metal truss joints, long primary baffle
"""
from __future__ import annotations

import math
import sys

import bmesh
import bpy
from mathutils import Matrix, Vector

BLEND_PATH = "/Users/tianqiming/Desktop/telescope-rc14.blend"

# --- Photron 6116 dimensions (meters) ---
APERTURE = 0.355
SEC_MIRROR = 0.150
SEC_OBSTRUCTION = 0.166
TUBE_LENGTH = 0.960
TUBE_DIAM = 0.533  # outer across flats of octagon rings


def log(msg: str) -> None:
    print(f"[PHOTRON] {msg}", flush=True)


def link_object(obj: bpy.types.Object, coll: bpy.types.Collection) -> None:
    for c in list(obj.users_collection):
        c.objects.unlink(obj)
    coll.objects.link(obj)


def get_mat(name: str, color=(0.02, 0.02, 0.02, 1.0), metal=0.2, rough=0.45) -> bpy.types.Material:
    mat = bpy.data.materials.get(name)
    if mat is None:
        src = bpy.data.materials.get("C14Black") or bpy.data.materials.get("AnodizedBlack")
        if src:
            mat = src.copy()
            mat.name = name
        else:
            mat = bpy.data.materials.new(name)
            mat.diffuse_color = color
    mat.diffuse_color = color
    return mat


def assign_mat(obj: bpy.types.Object, mat: bpy.types.Material) -> None:
    if obj.data and hasattr(obj.data, "materials"):
        obj.data.materials.clear()
        obj.data.materials.append(mat)


def mesh_from_bm(name: str, bm: bmesh.types.BMesh) -> bpy.types.Mesh:
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    me.update()
    return me


def new_obj(name: str, mesh: bpy.types.Mesh, parent: bpy.types.Object, coll: bpy.types.Collection) -> bpy.types.Object:
    obj = bpy.data.objects.new(name, mesh)
    link_object(obj, coll)
    obj.parent = parent
    return obj


def oct_points(r_vertex: float, y: float):
    """Regular octagon vertices; r_vertex = circumradius."""
    return [
        (r_vertex * math.cos(math.radians(22.5 + i * 45)), y, r_vertex * math.sin(math.radians(22.5 + i * 45)))
        for i in range(8)
    ]


def circumradius_from_across_flats(width: float) -> float:
    # across flats = 2 * R * cos(22.5°)
    return width / (2.0 * math.cos(math.radians(22.5)))


def make_oct_annulus(name: str, outer_w: float, inner_w: float, thickness: float) -> bpy.types.Mesh:
    bm = bmesh.new()
    ro = circumradius_from_across_flats(outer_w)
    ri = circumradius_from_across_flats(inner_w)
    y0, y1 = -thickness * 0.5, thickness * 0.5
    o0 = [bm.verts.new(p) for p in oct_points(ro, y0)]
    o1 = [bm.verts.new(p) for p in oct_points(ro, y1)]
    i0 = [bm.verts.new(p) for p in oct_points(ri, y0)]
    i1 = [bm.verts.new(p) for p in oct_points(ri, y1)]

    def bridge(a, b):
        for i in range(8):
            j = (i + 1) % 8
            bm.faces.new([a[i], a[j], b[j], b[i]])

    bridge(o0, o1)
    bridge(i1, i0)
    for i in range(8):
        j = (i + 1) % 8
        bm.faces.new([o0[i], o0[j], i0[j], i0[i]])
        bm.faces.new([o1[j], o1[i], i1[i], i1[j]])
    return mesh_from_bm(name, bm)


def boolean_stadium_holes(host: bpy.types.Object, outer_w: float, thickness: float) -> None:
    """Stadium (capsule) cutouts on each of 8 flats — Photron signature."""
    ro = circumradius_from_across_flats(outer_w)
    # hole center at ~72% of outer radius
    for i in range(8):
        a = math.radians(22.5 + i * 45)
        cx = ro * 0.72 * math.cos(a)
        cz = ro * 0.72 * math.sin(a)
        # Stadium = box + 2 cylinders, or scaled capsule via cone stretched
        # Build capsule along tangential axis in XZ, extruded through Y
        length = outer_w * 0.20  # half-length of slot along flat (Photron stadiums are large)
        radius = outer_w * 0.055
        bm = bmesh.new()
        # Create cylinder along Z then reshape: use cube rounded
        bmesh.ops.create_cone(bm, cap_ends=True, segments=16, radius1=radius, radius2=radius, depth=thickness * 3.5)
        # Scale in X to elongate before rotating into place — make stadium by scaling
        # depth is Z; rotate to Y for through-plate
        bmesh.ops.rotate(bm, verts=bm.verts, cent=(0, 0, 0), matrix=Matrix.Rotation(math.radians(90), 3, "X"))
        # Now cylinder along Y. Scale X to elongate in one horizontal direction, then rotate around Y by `a`
        # First stretch in X (will become tangential after rot)
        # Better: create capsule manually
        bm.free()
        bm = bmesh.new()
        # Capsule in XZ plane extruded in Y: two half-circles + rectangle
        segs = 10
        y0, y1 = -thickness * 1.6, thickness * 1.6
        # Cross-section stadium in local u(tangential)/v(radial) then map to XZ
        pts = []
        # rectangle sides + semicircles
        for k in range(segs + 1):
            t = math.pi * k / segs  # 0..pi upper
            pts.append((length + radius * math.cos(t - math.pi / 2), radius * math.sin(t - math.pi / 2)))
        for k in range(segs + 1):
            t = math.pi * k / segs
            pts.append((-length + radius * math.cos(t + math.pi / 2), radius * math.sin(t + math.pi / 2)))

        tx, tz = -math.sin(a), math.cos(a)  # tangential
        rx, rz = math.cos(a), math.sin(a)  # radial

        def map_pt(u, v, y):
            return (cx + u * tx + v * rx, y, cz + u * tz + v * rz)

        v0 = [bm.verts.new(map_pt(u, v, y0)) for u, v in pts]
        v1 = [bm.verts.new(map_pt(u, v, y1)) for u, v in pts]
        n = len(pts)
        for k in range(n):
            j = (k + 1) % n
            bm.faces.new([v0[k], v0[j], v1[j], v1[k]])
        bm.faces.new(list(reversed(v0)))
        bm.faces.new(v1)
        cutter_mesh = mesh_from_bm(f"_stad_{host.name}_{i}", bm)
        cutter = bpy.data.objects.new(f"_stad_{host.name}_{i}", cutter_mesh)
        bpy.context.scene.collection.objects.link(cutter)

        mod = host.modifiers.new(name=f"Stad{i}", type="BOOLEAN")
        mod.operation = "DIFFERENCE"
        try:
            mod.solver = "EXACT"
        except TypeError:
            try:
                mod.solver = "FLOAT"
            except TypeError:
                pass
        mod.object = cutter
        bpy.context.view_layer.objects.active = host
        try:
            with bpy.context.temp_override(object=host, active_object=host, selected_objects=[host]):
                bpy.ops.object.modifier_apply(modifier=mod.name)
        except Exception as exc:
            log(f"stadium cut fail {i}: {exc}")
            if mod.name in host.modifiers:
                host.modifiers.remove(mod)
        bpy.data.objects.remove(cutter, do_unlink=True)


def make_tube_y(name: str, outer_r: float, inner_r: float, depth: float, segments: int = 64) -> bpy.types.Mesh:
    bm = bmesh.new()
    y0, y1 = -depth * 0.5, depth * 0.5

    def ring(r, y):
        return [
            bm.verts.new((r * math.cos(2 * math.pi * i / segments), y, r * math.sin(2 * math.pi * i / segments)))
            for i in range(segments)
        ]

    o0, o1 = ring(outer_r, y0), ring(outer_r, y1)
    i0, i1 = ring(inner_r, y0), ring(inner_r, y1)
    for i in range(segments):
        j = (i + 1) % segments
        bm.faces.new([o0[i], o0[j], o1[j], o1[i]])
        bm.faces.new([i1[i], i1[j], i0[j], i0[i]])
        bm.faces.new([o0[j], o0[i], i0[i], i0[j]])
        bm.faces.new([o1[i], o1[j], i1[j], i1[i]])
    return mesh_from_bm(name, bm)


def make_cyl_y(name: str, radius: float, depth: float, segments: int = 48, capped: bool = True) -> bpy.types.Mesh:
    bm = bmesh.new()
    bmesh.ops.create_cone(
        bm, cap_ends=capped, cap_tris=False, segments=segments, radius1=radius, radius2=radius, depth=depth
    )
    bmesh.ops.rotate(bm, verts=bm.verts, cent=(0, 0, 0), matrix=Matrix.Rotation(math.radians(90), 3, "X"))
    return mesh_from_bm(name, bm)


def make_box(name: str, size: Vector) -> bpy.types.Mesh:
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    bmesh.ops.scale(bm, verts=bm.verts, vec=size)
    return mesh_from_bm(name, bm)


def make_dovetail(name: str, length: float, width: float, height: float) -> bpy.types.Mesh:
    bm = bmesh.new()
    w, tw = width * 0.5, width * 0.38
    y0, y1 = -length * 0.5, length * 0.5
    profile = [(-w, 0.0), (w, 0.0), (tw, height), (-tw, height)]
    v0 = [bm.verts.new((x, y0, z)) for x, z in profile]
    v1 = [bm.verts.new((x, y1, z)) for x, z in profile]
    bm.faces.new(v0)
    bm.faces.new(list(reversed(v1)))
    for i in range(4):
        j = (i + 1) % 4
        bm.faces.new([v0[i], v0[j], v1[j], v1[i]])
    return mesh_from_bm(name, bm)


def make_rear_plate(name: str, outer_w: float, thickness: float) -> bpy.types.Mesh:
    """Rear support plate: octagon outer, circular focuser hole, decorative ring."""
    bm = bmesh.new()
    ro = circumradius_from_across_flats(outer_w)
    hole_r = 0.058  # ~M117 area
    y0, y1 = -thickness * 0.5, thickness * 0.5
    n = 8
    o0 = [bm.verts.new(p) for p in oct_points(ro, y0)]
    o1 = [bm.verts.new(p) for p in oct_points(ro, y1)]
    segs = 48
    h0 = [
        bm.verts.new((hole_r * math.cos(2 * math.pi * i / segs), y0, hole_r * math.sin(2 * math.pi * i / segs)))
        for i in range(segs)
    ]
    h1 = [
        bm.verts.new((hole_r * math.cos(2 * math.pi * i / segs), y1, hole_r * math.sin(2 * math.pi * i / segs)))
        for i in range(segs)
    ]

    def bridge(a, b):
        for i in range(len(a)):
            j = (i + 1) % len(a)
            bm.faces.new([a[i], a[j], b[j], b[i]])

    bridge(o0, o1)
    bridge(h1, h0)
    # Fill caps with triangle fans from rim — approximate: connect oct to hole via radial
    for i in range(n):
        j = (i + 1) % n
        # map oct edge to hole arc range
        a0 = math.atan2(o0[i].co.z, o0[i].co.x)
        a1 = math.atan2(o0[j].co.z, o0[j].co.x)
        # pick hole verts in angular span
        def ang(v):
            return math.atan2(v.co.z, v.co.x)

        # simple: fan each oct corner to nearest hole verts
        hi = min(range(segs), key=lambda k: abs(((ang(h0[k]) - a0 + math.pi) % (2 * math.pi)) - math.pi))
        hj = min(range(segs), key=lambda k: abs(((ang(h0[k]) - a1 + math.pi) % (2 * math.pi)) - math.pi))
        # walk hole indices from hi to hj
        idxs = []
        k = hi
        for _ in range(segs):
            idxs.append(k)
            if k == hj:
                break
            k = (k + 1) % segs
        try:
            bm.faces.new([o0[i], o0[j]] + [h0[k] for k in reversed(idxs)])
        except ValueError:
            bm.faces.new([o0[i], o0[j], h0[hj], h0[hi]])
        try:
            bm.faces.new([o1[j], o1[i]] + [h1[k] for k in idxs])
        except ValueError:
            bm.faces.new([o1[j], o1[i], h1[hi], h1[hj]])
    return mesh_from_bm(name, bm)


def delete_old_rc14() -> None:
    keep = {"RC14_ROOT"}
    doomed = [o for o in list(bpy.data.objects) if o.name.startswith("RC14_") and o.name not in keep]
    log(f"Removing {len(doomed)} old RC14 parts")
    for o in doomed:
        bpy.data.objects.remove(o, do_unlink=True)


def build_photron(root: bpy.types.Object, coll: bpy.types.Collection) -> bpy.types.Object:
    mat_black = get_mat("RC14_Black", (0.015, 0.015, 0.017, 1), metal=0.25, rough=0.4)
    mat_carbon = get_mat("RC14_Carbon", (0.012, 0.012, 0.014, 1), metal=0.05, rough=0.55)
    mat_silver = get_mat("RC14_Silver", (0.55, 0.55, 0.58, 1), metal=0.85, rough=0.25)
    mat_mirror = get_mat("RC14_Mirror", (0.08, 0.08, 0.09, 1), metal=0.9, rough=0.08)

    outer_w = TUBE_DIAM  # 0.533
    inner_w_rear = 0.400
    inner_w_mid = 0.410
    inner_w_front = 0.380
    ro = circumradius_from_across_flats(outer_w)

    # Optical layout: +Y front, -Y rear; total span ~960mm
    y_front = TUBE_LENGTH * 0.48  # ~0.461
    y_mid = TUBE_LENGTH * 0.02
    y_rear_ring = -TUBE_LENGTH * 0.28
    y_rear_plate = -TUBE_LENGTH * 0.48  # ~-0.461
    y_cell = (y_rear_ring + y_rear_plate) * 0.5
    y_secondary = y_front + 0.01
    baffle_len = 0.38
    y_baffle = y_rear_ring + 0.18

    def add_ring(name, inner_w, thick, y, do_cut=True):
        mesh = make_oct_annulus(name, outer_w, inner_w, thick)
        obj = bpy.data.objects.new(name, mesh)
        bpy.context.scene.collection.objects.link(obj)
        if do_cut:
            boolean_stadium_holes(obj, outer_w, thick)
        link_object(obj, coll)
        obj.parent = root
        obj.location = (0, y, 0)
        assign_mat(obj, mat_black)
        return obj

    log("Building octagon rings with stadium cutouts...")
    add_ring("RC14_RearRing", inner_w_rear, 0.016, y_rear_ring)
    add_ring("RC14_MidRing", inner_w_mid, 0.014, y_mid)
    add_ring("RC14_FrontRing", inner_w_front, 0.012, y_front)

    # Primary cell drum between rear ring and rear plate
    cell = new_obj(
        "RC14_RearCell",
        make_tube_y("RC14_RearCell", outer_w * 0.48, APERTURE * 0.42, abs(y_rear_ring - y_rear_plate) * 0.85, 64),
        root,
        coll,
    )
    cell.location = (0, y_cell, 0)
    assign_mat(cell, mat_black)

    # Rear plate with focuser hole
    plate_mesh = make_rear_plate("RC14_RearPlate", outer_w * 0.98, 0.012)
    plate = bpy.data.objects.new("RC14_RearPlate", plate_mesh)
    bpy.context.scene.collection.objects.link(plate)
    # lightening holes on plate flats
    boolean_stadium_holes(plate, outer_w * 0.98, 0.012)
    link_object(plate, coll)
    plate.parent = root
    plate.location = (0, y_rear_plate, 0)
    assign_mat(plate, mat_black)

    # Primary mirror
    bm = bmesh.new()
    segs = 64
    center = bm.verts.new((0, -0.01, 0))
    ring = [
        bm.verts.new((APERTURE * 0.49 * math.cos(2 * math.pi * i / segs), 0, APERTURE * 0.49 * math.sin(2 * math.pi * i / segs)))
        for i in range(segs)
    ]
    for i in range(segs):
        bm.faces.new([center, ring[(i + 1) % segs], ring[i]])
    mirror = new_obj("RC14_PrimaryMirror", mesh_from_bm("RC14_PrimaryMirror", bm), root, coll)
    mirror.location = (0, y_cell + 0.02, 0)
    assign_mat(mirror, mat_mirror)

    # Long primary baffle
    baffle = new_obj(
        "RC14_PrimaryBaffle",
        make_tube_y("RC14_PrimaryBaffle", APERTURE * 0.195, APERTURE * 0.155, baffle_len, 48),
        root,
        coll,
    )
    baffle.location = (0, y_baffle, 0)
    assign_mat(baffle, mat_black)

    # Focuser collar (M117 style) — camera attaches here, on-axis
    collar = new_obj(
        "RC14_FocuserCollar",
        make_tube_y("RC14_FocuserCollar", 0.068, 0.050, 0.028, 48),
        root,
        coll,
    )
    collar.location = (0, y_rear_plate - 0.022, 0)
    assign_mat(collar, mat_black)

    collar_ring = new_obj(
        "RC14_FocuserRing",
        make_cyl_y("RC14_FocuserRing", 0.072, 0.008, 48),
        root,
        coll,
    )
    collar_ring.location = (0, y_rear_plate - 0.008, 0)
    assign_mat(collar_ring, mat_silver)

    # Three cooling fans with wire-guard look
    for i, ang_deg in enumerate((90, 210, 330)):
        a = math.radians(ang_deg)
        r = 0.145
        fan = new_obj(
            f"RC14_Fan_{i}",
            make_cyl_y(f"RC14_Fan_{i}", 0.028, 0.008, 24),
            root,
            coll,
        )
        fan.location = (r * math.cos(a), y_rear_plate - 0.006, r * math.sin(a))
        assign_mat(fan, mat_silver)
        # guard ring
        guard = new_obj(
            f"RC14_FanGuard_{i}",
            make_tube_y(f"RC14_FanGuard_{i}", 0.030, 0.026, 0.004, 24),
            root,
            coll,
        )
        guard.location = (r * math.cos(a), y_rear_plate - 0.012, r * math.sin(a))
        assign_mat(guard, mat_silver)

    # Collimation screw pairs on rear (decorative)
    for i in range(3):
        a = math.radians(30 + i * 120)
        r = 0.095
        lock = new_obj(f"RC14_ColLock_{i}", make_cyl_y(f"RC14_ColLock_{i}", 0.004, 0.01, 8), root, coll)
        lock.location = (r * math.cos(a), y_rear_plate - 0.01, r * math.sin(a))
        assign_mat(lock, mat_black)
        chrome = new_obj(f"RC14_ColChrome_{i}", make_cyl_y(f"RC14_ColChrome_{i}", 0.006, 0.012, 8), root, coll)
        chrome.location = ((r + 0.02) * math.cos(a), y_rear_plate - 0.01, (r + 0.02) * math.sin(a))
        assign_mat(chrome, mat_silver)

    # Silver truss joint blocks at octagon vertices
    def add_joint(name, y, ang):
        blk = new_obj(name, make_box(name, Vector((0.032, 0.036, 0.024))), root, coll)
        blk.location = (ro * 0.92 * math.cos(ang), y, ro * 0.92 * math.sin(ang))
        blk.rotation_euler = (0, -ang, 0)
        assign_mat(blk, mat_silver)
        return blk

    for i in range(8):
        a = math.radians(22.5 + i * 45)
        add_joint(f"RC14_JointR_{i}", y_rear_ring, a)
        add_joint(f"RC14_JointM_{i}", y_mid, a)
        add_joint(f"RC14_JointF_{i}", y_front, a)

    # Serrurier trusses: V-pairs between rings (8 corners)
    idx = 0

    def add_truss(y_a, y_b, ang_a, ang_b):
        nonlocal idx
        r = ro * 0.92
        p0 = Vector((r * math.cos(ang_a), y_a, r * math.sin(ang_a)))
        p1 = Vector((r * math.cos(ang_b), y_b, r * math.sin(ang_b)))
        mid = (p0 + p1) * 0.5
        direction = p1 - p0
        length = direction.length
        tube = new_obj(
            f"RC14_Truss_{idx}",
            make_cyl_y(f"RC14_Truss_{idx}", 0.008, length, 12),
            root,
            coll,
        )
        idx += 1
        tube.location = mid
        tube.rotation_mode = "QUATERNION"
        tube.rotation_quaternion = Vector((0, 1, 0)).rotation_difference(direction.normalized())
        assign_mat(tube, mat_carbon)

    log("Building Serrurier carbon trusses...")
    for i in range(8):
        a0 = math.radians(22.5 + i * 45)
        a1 = math.radians(22.5 + ((i + 1) % 8) * 45)
        add_truss(y_rear_ring, y_mid, a0, a1)
        add_truss(y_rear_ring, y_mid, a1, a0)
        add_truss(y_mid, y_front, a0, a1)
        add_truss(y_mid, y_front, a1, a0)

    # Secondary housing (obstruction 166mm)
    sec_r = SEC_OBSTRUCTION * 0.5
    sec = new_obj(
        "RC14_Secondary",
        make_tube_y("RC14_Secondary", sec_r, sec_r * 0.55, 0.070, 48),
        root,
        coll,
    )
    sec.location = (0, y_secondary, 0)
    assign_mat(sec, mat_black)

    sec_cap = new_obj(
        "RC14_SecondaryCap",
        make_cyl_y("RC14_SecondaryCap", sec_r * 0.95, 0.010, 32),
        root,
        coll,
    )
    sec_cap.location = (0, y_secondary + 0.038, 0)
    assign_mat(sec_cap, mat_black)

    # 3 collimation screws + center (do not adjust center!)
    for i, ang in enumerate((0, 120, 240)):
        a = math.radians(ang)
        screw = new_obj(f"RC14_SecScrew_{i}", make_cyl_y(f"RC14_SecScrew_{i}", 0.0035, 0.008, 8), root, coll)
        screw.location = (0.025 * math.cos(a), y_secondary + 0.045, 0.025 * math.sin(a))
        assign_mat(screw, mat_silver)
    center_screw = new_obj("RC14_SecCenter", make_cyl_y("RC14_SecCenter", 0.004, 0.006, 8), root, coll)
    center_screw.location = (0, y_secondary + 0.045, 0)
    assign_mat(center_screw, mat_silver)

    # 4-vane spider in + (cardinal) — Photron front photo
    for i in range(4):
        ang = math.radians(i * 90)  # + orientation
        span = circumradius_from_across_flats(inner_w_front) - sec_r * 0.95
        vane = new_obj(
            f"RC14_Spider_{i}",
            make_box(f"RC14_Spider_{i}", Vector((0.0016, 0.010, span))),
            root,
            coll,
        )
        r_mid = (sec_r + circumradius_from_across_flats(inner_w_front)) * 0.5
        vane.location = (r_mid * math.cos(ang), y_front + 0.004, r_mid * math.sin(ang))
        vane.rotation_euler = (0, -ang + math.radians(90), 0)
        assign_mat(vane, mat_black)

    # Dual Losmandy dovetails spanning rear↔front
    dov_len = abs(y_front - y_rear_ring) * 0.92
    dov_y = (y_front + y_rear_ring) * 0.5
    dov_z = outer_w * 0.48
    bottom = new_obj(
        "RC14_Dovetail",
        make_dovetail("RC14_Dovetail", length=dov_len, width=0.078, height=0.018),
        root,
        coll,
    )
    bottom.location = (0.0, dov_y, -dov_z)
    bottom.rotation_euler = (math.radians(180), 0, 0)
    assign_mat(bottom, mat_black)

    top = new_obj(
        "RC14_TopRail",
        make_dovetail("RC14_TopRail", length=dov_len * 0.95, width=0.072, height=0.016),
        root,
        coll,
    )
    top.location = (0.0, dov_y, dov_z)
    assign_mat(top, mat_black)

    # Finder shoe on front ring (Vixen-type base)
    shoe = new_obj("RC14_FinderShoe", make_box("RC14_FinderShoe", Vector((0.02, 0.04, 0.012))), root, coll)
    shoe.location = (0.0, y_front, outer_w * 0.42)
    assign_mat(shoe, mat_black)

    # FOCUSER empty — coaxial, behind collar
    focuser = bpy.data.objects.new("RC14_FOCUSER", None)
    focuser.empty_display_type = "CIRCLE"
    focuser.empty_display_size = 0.05
    link_object(focuser, coll)
    focuser.parent = root
    focuser.location = (0.0, collar.location.y - 0.05, 0.0)
    focuser.rotation_euler = (0, 0, 0)

    log(f"Photron RC14 built: L={TUBE_LENGTH} D={TUBE_DIAM} sec_obs={SEC_OBSTRUCTION}")
    return focuser


def attach_imaging_train(focuser: bpy.types.Object) -> None:
    it = bpy.data.objects.get("IMAGING_TRAIN")
    if not it:
        log("WARNING: no IMAGING_TRAIN")
        return
    it.parent = focuser
    it.matrix_parent_inverse.identity()
    # Coaxial — NO -90° diagonal
    it.location = (0.0, -0.02, 0.0)
    it.rotation_euler = (0.0, 0.0, 0.0)
    it.scale = (1, 1, 1)
    bpy.context.view_layer.update()
    zwo = bpy.data.objects.get("IT_ZWO_Body")
    rear = bpy.data.objects.get("RC14_RearPlate") or bpy.data.objects.get("RC14_RearCell")
    sec = bpy.data.objects.get("RC14_Secondary")
    if zwo and rear and sec:
        stack = Vector(zwo.matrix_world.translation) - Vector(focuser.matrix_world.translation)
        optical = Vector(sec.matrix_world.translation) - Vector(rear.matrix_world.translation)
        if stack.length > 1e-6 and optical.length > 1e-6:
            log(f"stack·rear = {stack.normalized().dot((-optical).normalized()):.3f}")


def main() -> None:
    log(f"Open {BLEND_PATH}")
    bpy.ops.wm.open_mainfile(filepath=BLEND_PATH)

    root = bpy.data.objects.get("RC14_ROOT")
    if not root:
        log("FATAL: RC14_ROOT missing")
        sys.exit(1)

    coll = bpy.data.collections.get("03_RC14")
    if coll is None:
        coll = root.users_collection[0] if root.users_collection else bpy.context.scene.collection

    # Detach imaging train before deleting focuser
    it = bpy.data.objects.get("IMAGING_TRAIN")
    if it:
        mw = it.matrix_world.copy()
        it.parent = None
        it.matrix_world = mw

    delete_old_rc14()
    focuser = build_photron(root, coll)
    attach_imaging_train(focuser)

    img_coll = bpy.data.collections.get("04_ImagingTrain")
    if it and img_coll and it.name not in [o.name for o in img_coll.objects]:
        try:
            img_coll.objects.link(it)
        except RuntimeError:
            pass

    for n in ("ME_RA_SPIN", "ME_DEC_SPIN", "RC14_ROOT", "IMAGING_TRAIN", "RC14_FOCUSER", "RC14_FrontRing"):
        log(f"check {n}: {'OK' if bpy.data.objects.get(n) else 'MISSING'}")

    bpy.ops.wm.save_as_mainfile(filepath=BLEND_PATH)
    log(f"Saved {BLEND_PATH}")


if __name__ == "__main__":
    main()

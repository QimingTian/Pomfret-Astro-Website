"""
Fix Photron RC14 proportions from official photo 6116-2:

Silhouette: mid WIDEST, front & rear NARROWER (not a constant cylinder).
Bays: front half LONGER; rear truss bay SHORTER.
Rear enclosed primary cell (环绕盖板) length ≈ mid/rear truss bay length.
Skip fancy cutouts — structure first.
Camera stays coaxial on RC14_FOCUSER.
"""
from __future__ import annotations

import math
import sys

import bmesh
import bpy
from mathutils import Matrix, Vector

BLEND_PATH = "/Users/tianqiming/Desktop/telescope-rc14.blend"

# Official overall
TUBE_LENGTH = 0.960
MID_WIDTH = 0.533          # widest — official tube diameter
FRONT_WIDTH = 0.430        # narrower front ring (6116-2 / 6116-3)
REAR_WIDTH = 0.480         # rear ring slightly under mid
CELL_WIDTH = 0.470         # enclosed primary cell drum
SEC_OBS = 0.166
APERTURE = 0.355

# Bay lengths along +Y front / -Y rear (sum ≈ 0.960)
# front_bay long; rear_bay short; cell ≈ rear_bay
FRONT_BAY = 0.48           # mid → front
REAR_BAY = 0.24            # rear_ring → mid  ("中间的 tube")
CELL_LEN = 0.24            # enclosed rear cover ≈ rear_bay


def log(msg: str) -> None:
    print(f"[PROP] {msg}", flush=True)


def link_object(obj, coll):
    for c in list(obj.users_collection):
        c.objects.unlink(obj)
    coll.objects.link(obj)


def get_mat(name, color=(0.02, 0.02, 0.02, 1.0)):
    mat = bpy.data.materials.get(name)
    if mat is None:
        src = bpy.data.materials.get("C14Black") or bpy.data.materials.get("AnodizedBlack")
        mat = src.copy() if src else bpy.data.materials.new(name)
        mat.name = name
    mat.diffuse_color = color
    return mat


def assign_mat(obj, mat):
    if obj.data and hasattr(obj.data, "materials"):
        obj.data.materials.clear()
        obj.data.materials.append(mat)


def mesh_from_bm(name, bm):
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    me.update()
    return me


def new_obj(name, mesh, parent, coll):
    obj = bpy.data.objects.new(name, mesh)
    link_object(obj, coll)
    obj.parent = parent
    return obj


def circum_r(across_flats):
    return across_flats / (2.0 * math.cos(math.radians(22.5)))


def oct_pts(r, y):
    return [
        (r * math.cos(math.radians(22.5 + i * 45)), y, r * math.sin(math.radians(22.5 + i * 45)))
        for i in range(8)
    ]


def make_oct_ring(name, outer_w, inner_w, thick):
    """Simple octagon annulus — no cutout booleans."""
    bm = bmesh.new()
    ro, ri = circum_r(outer_w), circum_r(inner_w)
    y0, y1 = -thick * 0.5, thick * 0.5
    o0 = [bm.verts.new(p) for p in oct_pts(ro, y0)]
    o1 = [bm.verts.new(p) for p in oct_pts(ro, y1)]
    i0 = [bm.verts.new(p) for p in oct_pts(ri, y0)]
    i1 = [bm.verts.new(p) for p in oct_pts(ri, y1)]

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


def make_tube_y(name, outer_r, inner_r, depth, segs=48):
    bm = bmesh.new()
    y0, y1 = -depth * 0.5, depth * 0.5

    def ring(r, y):
        return [
            bm.verts.new((r * math.cos(2 * math.pi * i / segs), y, r * math.sin(2 * math.pi * i / segs)))
            for i in range(segs)
        ]

    o0, o1, i0, i1 = ring(outer_r, y0), ring(outer_r, y1), ring(inner_r, y0), ring(inner_r, y1)
    for i in range(segs):
        j = (i + 1) % segs
        bm.faces.new([o0[i], o0[j], o1[j], o1[i]])
        bm.faces.new([i1[i], i1[j], i0[j], i0[i]])
        bm.faces.new([o0[j], o0[i], i0[i], i0[j]])
        bm.faces.new([o1[i], o1[j], i1[j], i1[i]])
    return mesh_from_bm(name, bm)


def make_cyl_y(name, radius, depth, segs=32, capped=True):
    bm = bmesh.new()
    bmesh.ops.create_cone(
        bm, cap_ends=capped, segments=segs, radius1=radius, radius2=radius, depth=depth
    )
    bmesh.ops.rotate(bm, verts=bm.verts, cent=(0, 0, 0), matrix=Matrix.Rotation(math.radians(90), 3, "X"))
    return mesh_from_bm(name, bm)


def make_box(name, size):
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    bmesh.ops.scale(bm, verts=bm.verts, vec=size)
    return mesh_from_bm(name, bm)


def make_dovetail(name, length, width, height):
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


def delete_rc_parts():
    keep = {"RC14_ROOT"}
    doomed = [o for o in list(bpy.data.objects) if o.name.startswith("RC14_") and o.name not in keep]
    log(f"delete {len(doomed)} RC14 parts")
    for o in doomed:
        bpy.data.objects.remove(o, do_unlink=True)


def build(root, coll):
    mat_b = get_mat("RC14_Black", (0.015, 0.015, 0.017, 1))
    mat_c = get_mat("RC14_Carbon", (0.012, 0.012, 0.014, 1))
    mat_s = get_mat("RC14_Silver", (0.55, 0.55, 0.58, 1))
    mat_m = get_mat("RC14_Mirror", (0.07, 0.07, 0.08, 1))

    # Layout: place mid near CG; front +FRONT_BAY; rear ring -REAR_BAY; plate further -CELL_LEN
    y_mid = 0.02
    y_front = y_mid + FRONT_BAY          # +0.50
    y_rear_ring = y_mid - REAR_BAY       # -0.22
    y_rear_plate = y_rear_ring - CELL_LEN  # -0.46
    y_cell = (y_rear_ring + y_rear_plate) * 0.5
    y_secondary = y_front + 0.008
    y_baffle = y_rear_ring + 0.12

    span = y_front - y_rear_plate
    log(f"layout front_bay={FRONT_BAY} rear_bay={REAR_BAY} cell={CELL_LEN} total_span={span:.3f}")
    log(f"widths front={FRONT_WIDTH} mid={MID_WIDTH} rear={REAR_WIDTH} (mid widest)")

    def add_ring(name, outer_w, inner_frac, thick, y):
        inner_w = outer_w * inner_frac
        obj = new_obj(name, make_oct_ring(name, outer_w, inner_w, thick), root, coll)
        obj.location = (0, y, 0)
        assign_mat(obj, mat_b)
        return obj

    add_ring("RC14_FrontRing", FRONT_WIDTH, 0.78, 0.012, y_front)
    add_ring("RC14_MidRing", MID_WIDTH, 0.78, 0.014, y_mid)
    add_ring("RC14_RearRing", REAR_WIDTH, 0.78, 0.016, y_rear_ring)

    # Enclosed primary cell — short drum, length ≈ rear_bay, diameter < mid
    cell = new_obj(
        "RC14_RearCell",
        make_tube_y("RC14_RearCell", CELL_WIDTH * 0.5, APERTURE * 0.42, CELL_LEN * 0.92, 64),
        root,
        coll,
    )
    cell.location = (0, y_cell, 0)
    assign_mat(cell, mat_b)

    # Rear plate (盖板) at back of cell
    plate = new_obj(
        "RC14_RearPlate",
        make_oct_ring("RC14_RearPlate", REAR_WIDTH * 0.98, 0.12, 0.012),
        root,
        coll,
    )
    plate.location = (0, y_rear_plate, 0)
    assign_mat(plate, mat_b)

    # Primary mirror
    bm = bmesh.new()
    segs = 48
    ctr = bm.verts.new((0, -0.008, 0))
    ring = [
        bm.verts.new((APERTURE * 0.48 * math.cos(2 * math.pi * i / segs), 0, APERTURE * 0.48 * math.sin(2 * math.pi * i / segs)))
        for i in range(segs)
    ]
    for i in range(segs):
        bm.faces.new([ctr, ring[(i + 1) % segs], ring[i]])
    mirror = new_obj("RC14_PrimaryMirror", mesh_from_bm("RC14_PrimaryMirror", bm), root, coll)
    mirror.location = (0, y_cell + 0.02, 0)
    assign_mat(mirror, mat_m)

    # Primary baffle extending into front bay
    baffle = new_obj(
        "RC14_PrimaryBaffle",
        make_tube_y("RC14_PrimaryBaffle", APERTURE * 0.19, APERTURE * 0.15, 0.36, 40),
        root,
        coll,
    )
    baffle.location = (0, y_baffle, 0)
    assign_mat(baffle, mat_b)

    # Focuser collar on axis
    collar = new_obj(
        "RC14_FocuserCollar",
        make_tube_y("RC14_FocuserCollar", 0.065, 0.048, 0.028, 40),
        root,
        coll,
    )
    collar.location = (0, y_rear_plate - 0.022, 0)
    assign_mat(collar, mat_b)
    ring_s = new_obj("RC14_FocuserRing", make_cyl_y("RC14_FocuserRing", 0.070, 0.008, 32), root, coll)
    ring_s.location = (0, y_rear_plate - 0.008, 0)
    assign_mat(ring_s, mat_s)

    # 3 fans on rear plate
    for i, ang in enumerate((90, 210, 330)):
        a = math.radians(ang)
        r = REAR_WIDTH * 0.28
        fan = new_obj(f"RC14_Fan_{i}", make_cyl_y(f"RC14_Fan_{i}", 0.026, 0.008, 20), root, coll)
        fan.location = (r * math.cos(a), y_rear_plate - 0.006, r * math.sin(a))
        assign_mat(fan, mat_s)

    # Joint blocks at ring vertices (scaled to each ring)
    def joints(prefix, y, width):
        ro = circum_r(width) * 0.92
        for i in range(8):
            a = math.radians(22.5 + i * 45)
            blk = new_obj(f"{prefix}_{i}", make_box(f"{prefix}_{i}", Vector((0.028, 0.032, 0.022))), root, coll)
            blk.location = (ro * math.cos(a), y, ro * math.sin(a))
            blk.rotation_euler = (0, -a, 0)
            assign_mat(blk, mat_s)

    joints("RC14_JointF", y_front, FRONT_WIDTH)
    joints("RC14_JointM", y_mid, MID_WIDTH)
    joints("RC14_JointR", y_rear_ring, REAR_WIDTH)

    # Serrurier: V pairs. Use each ring's own radius so silhouette tapers.
    idx = 0

    def add_truss(y_a, y_b, w_a, w_b, ang_a, ang_b):
        nonlocal idx
        ra, rb = circum_r(w_a) * 0.92, circum_r(w_b) * 0.92
        p0 = Vector((ra * math.cos(ang_a), y_a, ra * math.sin(ang_a)))
        p1 = Vector((rb * math.cos(ang_b), y_b, rb * math.sin(ang_b)))
        mid = (p0 + p1) * 0.5
        d = p1 - p0
        tube = new_obj(
            f"RC14_Truss_{idx}",
            make_cyl_y(f"RC14_Truss_{idx}", 0.0075, d.length, 10),
            root,
            coll,
        )
        idx += 1
        tube.location = mid
        tube.rotation_mode = "QUATERNION"
        tube.rotation_quaternion = Vector((0, 1, 0)).rotation_difference(d.normalized())
        assign_mat(tube, mat_c)

    for i in range(8):
        a0 = math.radians(22.5 + i * 45)
        a1 = math.radians(22.5 + ((i + 1) % 8) * 45)
        # rear bay (short): rear_ring ↔ mid
        add_truss(y_rear_ring, y_mid, REAR_WIDTH, MID_WIDTH, a0, a1)
        add_truss(y_rear_ring, y_mid, REAR_WIDTH, MID_WIDTH, a1, a0)
        # front bay (long): mid ↔ front
        add_truss(y_mid, y_front, MID_WIDTH, FRONT_WIDTH, a0, a1)
        add_truss(y_mid, y_front, MID_WIDTH, FRONT_WIDTH, a1, a0)

    # Secondary + spider (+)
    sec_r = SEC_OBS * 0.5
    sec = new_obj(
        "RC14_Secondary",
        make_tube_y("RC14_Secondary", sec_r, sec_r * 0.55, 0.065, 40),
        root,
        coll,
    )
    sec.location = (0, y_secondary, 0)
    assign_mat(sec, mat_b)
    cap = new_obj("RC14_SecondaryCap", make_cyl_y("RC14_SecondaryCap", sec_r * 0.92, 0.01, 24), root, coll)
    cap.location = (0, y_secondary + 0.035, 0)
    assign_mat(cap, mat_b)
    for i, ang in enumerate((0, 120, 240)):
        a = math.radians(ang)
        sc = new_obj(f"RC14_SecScrew_{i}", make_cyl_y(f"RC14_SecScrew_{i}", 0.003, 0.007, 6), root, coll)
        sc.location = (0.022 * math.cos(a), y_secondary + 0.042, 0.022 * math.sin(a))
        assign_mat(sc, mat_s)

    front_inner_r = circum_r(FRONT_WIDTH * 0.78)
    for i in range(4):
        ang = math.radians(i * 90)
        span = front_inner_r - sec_r * 0.9
        vane = new_obj(
            f"RC14_Spider_{i}",
            make_box(f"RC14_Spider_{i}", Vector((0.0015, 0.01, span))),
            root,
            coll,
        )
        rm = (sec_r + front_inner_r) * 0.5
        vane.location = (rm * math.cos(ang), y_front + 0.003, rm * math.sin(ang))
        vane.rotation_euler = (0, -ang + math.radians(90), 0)
        assign_mat(vane, mat_b)

    # Dovetails along mid width (mount clamps)
    dov_len = (y_front - y_rear_ring) * 0.9
    dov_y = (y_front + y_rear_ring) * 0.5
    bottom = new_obj(
        "RC14_Dovetail",
        make_dovetail("RC14_Dovetail", dov_len, 0.078, 0.018),
        root,
        coll,
    )
    bottom.location = (0.0, dov_y, -0.208)
    bottom.rotation_euler = (math.radians(180), 0, 0)
    assign_mat(bottom, mat_b)
    top = new_obj(
        "RC14_TopRail",
        make_dovetail("RC14_TopRail", dov_len * 0.95, 0.070, 0.016),
        root,
        coll,
    )
    top.location = (0.0, dov_y, 0.208)
    assign_mat(top, mat_b)

    focuser = bpy.data.objects.new("RC14_FOCUSER", None)
    focuser.empty_display_type = "CIRCLE"
    focuser.empty_display_size = 0.05
    link_object(focuser, coll)
    focuser.parent = root
    focuser.location = (0.0, collar.location.y - 0.05, 0.0)
    focuser.rotation_euler = (0, 0, 0)

    log("structure built")
    return focuser


def attach_cam(focuser):
    it = bpy.data.objects.get("IMAGING_TRAIN")
    if not it:
        return
    it.parent = focuser
    it.matrix_parent_inverse.identity()
    it.location = (0.0, -0.02, 0.0)
    it.rotation_euler = (0, 0, 0)
    it.scale = (1, 1, 1)
    bpy.context.view_layer.update()
    zwo = bpy.data.objects.get("IT_ZWO_Body")
    rear = bpy.data.objects.get("RC14_RearPlate")
    sec = bpy.data.objects.get("RC14_Secondary")
    if zwo and rear and sec:
        stack = Vector(zwo.matrix_world.translation) - Vector(focuser.matrix_world.translation)
        optical = Vector(sec.matrix_world.translation) - Vector(rear.matrix_world.translation)
        log(f"stack·rear={stack.normalized().dot((-optical).normalized()):.3f}")


def main():
    bpy.ops.wm.open_mainfile(filepath=BLEND_PATH)
    root = bpy.data.objects.get("RC14_ROOT")
    if not root:
        log("FATAL no RC14_ROOT")
        sys.exit(1)
    coll = bpy.data.collections.get("03_RC14") or (
        root.users_collection[0] if root.users_collection else bpy.context.scene.collection
    )

    it = bpy.data.objects.get("IMAGING_TRAIN")
    if it:
        mw = it.matrix_world.copy()
        it.parent = None
        it.matrix_world = mw

    delete_rc_parts()
    focuser = build(root, coll)
    attach_cam(focuser)

    # Report proportions
    for n in ("RC14_FrontRing", "RC14_MidRing", "RC14_RearRing", "RC14_RearCell", "RC14_RearPlate"):
        o = bpy.data.objects.get(n)
        if not o:
            continue
        xs = [(o.matrix_local @ Vector(c)).x for c in o.bound_box]
        zs = [(o.matrix_local @ Vector(c)).z for c in o.bound_box]
        w = max(max(xs) - min(xs), max(zs) - min(zs))
        log(f"{n}: y={o.location.y:.3f} width~{w:.3f}")

    front = bpy.data.objects["RC14_FrontRing"].location.y
    mid = bpy.data.objects["RC14_MidRing"].location.y
    rear_r = bpy.data.objects["RC14_RearRing"].location.y
    plate = bpy.data.objects["RC14_RearPlate"].location.y
    log(f"front_bay={front-mid:.3f} rear_bay={mid-rear_r:.3f} cell={rear_r-plate:.3f}")

    bpy.ops.wm.save_as_mainfile(filepath=BLEND_PATH)
    log(f"saved {BLEND_PATH}")


if __name__ == "__main__":
    main()

"""
Photron RC14 structure fix per user + 6116-2:

Three octagon rings 1, 2, 3 (NOT a separate mid truss ring):
  Ring1 = rearmost (back of mirror cell)
  Ring2 = widest — front of mirror cell; "中宽" means THIS ring
  Ring3 = head / secondary end

Distances: 1↔2 SMALL (mirror cell between them)
           2↔3 LARGE (main truss bay)

RearCell sits between rings 1–2 and has external support braces (支架).
Camera stays coaxial on RC14_FOCUSER.
"""
from __future__ import annotations

import math
import sys

import bmesh
import bpy
from mathutils import Matrix, Vector

BLEND_PATH = "/Users/tianqiming/Desktop/telescope-rc14.blend"

TUBE_LENGTH = 0.960
# Widths: ring2 widest
W1 = 0.470   # ring1 rear
W2 = 0.533   # ring2 widest (official tube diam)
W3 = 0.430   # ring3 front/head
CELL_OD = 0.455
SEC_OBS = 0.166
APERTURE = 0.355

# Along +Y = front (ring3)
# Place ring2 near mount CG; ring1 behind; ring3 ahead
GAP_12 = 0.24          # short — mirror cell length
GAP_23 = 0.52          # long — main truss
# GAP_12 + GAP_23 = 0.76; add ring thickness / overhangs ≈ toward 0.96 overall OTA feel


def log(msg: str) -> None:
    print(f"[R123] {msg}", flush=True)


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


def circum_r(w):
    return w / (2.0 * math.cos(math.radians(22.5)))


def oct_pts(r, y):
    return [
        (r * math.cos(math.radians(22.5 + i * 45)), y, r * math.sin(math.radians(22.5 + i * 45)))
        for i in range(8)
    ]


def make_oct_ring(name, outer_w, inner_w, thick):
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
    log(f"delete {len(doomed)}")
    for o in doomed:
        bpy.data.objects.remove(o, do_unlink=True)


def build(root, coll):
    mat_b = get_mat("RC14_Black", (0.015, 0.015, 0.017, 1))
    mat_c = get_mat("RC14_Carbon", (0.012, 0.012, 0.014, 1))
    mat_s = get_mat("RC14_Silver", (0.55, 0.55, 0.58, 1))
    mat_m = get_mat("RC14_Mirror", (0.07, 0.07, 0.08, 1))

    # Ring positions: ring2 near VersaPlate CG
    y2 = 0.00                 # ring2 widest — cell front / truss attach
    y1 = y2 - GAP_12          # ring1 rear
    y3 = y2 + GAP_23          # ring3 head
    y_cell = (y1 + y2) * 0.5
    y_secondary = y3 + 0.006
    y_baffle = y2 + 0.10

    log(f"rings y1={y1:.3f} y2={y2:.3f} y3={y3:.3f}")
    log(f"gap12={GAP_12} gap23={GAP_23}  widths w1={W1} w2={W2}(widest) w3={W3}")

    def add_ring(name, w, thick, y):
        obj = new_obj(name, make_oct_ring(name, w, w * 0.78, thick), root, coll)
        obj.location = (0, y, 0)
        assign_mat(obj, mat_b)
        return obj

    # Named clearly as Ring1/2/3 — also keep aliases for compatibility
    r1 = add_ring("RC14_Ring1", W1, 0.014, y1)
    r2 = add_ring("RC14_Ring2", W2, 0.016, y2)
    r3 = add_ring("RC14_Ring3", W3, 0.012, y3)
    # Friendly aliases as empties? Better duplicate name refs via parenting only.
    # Also create empty markers / rename-style second names not needed — use Ring1/2/3 only.

    # Mirror cell BETWEEN ring1 and ring2
    cell = new_obj(
        "RC14_RearCell",
        make_tube_y("RC14_RearCell", CELL_OD * 0.5, APERTURE * 0.40, GAP_12 * 0.88, 56),
        root,
        coll,
    )
    cell.location = (0, y_cell, 0)
    assign_mat(cell, mat_b)

    # External braces / 支架 on outside of rear cell (6116-2):
    # longitudinal rails + light rings between ring1–ring2
    for i in range(8):
        a = math.radians(22.5 + i * 45)
        # only every other corner for cleaner look matching photo density
        if i % 2 != 0:
            continue
        r = CELL_OD * 0.52
        brace = new_obj(
            f"RC14_CellBrace_{i}",
            make_box(f"RC14_CellBrace_{i}", Vector((0.012, GAP_12 * 0.85, 0.018))),
            root,
            coll,
        )
        brace.location = (r * math.cos(a), y_cell, r * math.sin(a))
        brace.rotation_euler = (0, -a, 0)
        assign_mat(brace, mat_b)

    # Circumferential strap rings on cell exterior
    for k, yoff in enumerate((-0.06, 0.06)):
        strap = new_obj(
            f"RC14_CellStrap_{k}",
            make_tube_y(f"RC14_CellStrap_{k}", CELL_OD * 0.52, CELL_OD * 0.48, 0.016, 40),
            root,
            coll,
        )
        strap.location = (0, y_cell + yoff, 0)
        assign_mat(strap, mat_b)

    # Rear cover plate just behind ring1
    plate = new_obj(
        "RC14_RearPlate",
        make_oct_ring("RC14_RearPlate", W1 * 0.98, 0.12, 0.012),
        root,
        coll,
    )
    plate.location = (0, y1 - 0.010, 0)
    assign_mat(plate, mat_b)

    # Primary mirror
    bm = bmesh.new()
    segs = 48
    ctr = bm.verts.new((0, -0.008, 0))
    ringv = [
        bm.verts.new((APERTURE * 0.48 * math.cos(2 * math.pi * i / segs), 0, APERTURE * 0.48 * math.sin(2 * math.pi * i / segs)))
        for i in range(segs)
    ]
    for i in range(segs):
        bm.faces.new([ctr, ringv[(i + 1) % segs], ringv[i]])
    mirror = new_obj("RC14_PrimaryMirror", mesh_from_bm("RC14_PrimaryMirror", bm), root, coll)
    mirror.location = (0, y_cell + 0.02, 0)
    assign_mat(mirror, mat_m)

    baffle = new_obj(
        "RC14_PrimaryBaffle",
        make_tube_y("RC14_PrimaryBaffle", APERTURE * 0.19, APERTURE * 0.15, 0.40, 40),
        root,
        coll,
    )
    baffle.location = (0, y_baffle, 0)
    assign_mat(baffle, mat_b)

    collar = new_obj(
        "RC14_FocuserCollar",
        make_tube_y("RC14_FocuserCollar", 0.065, 0.048, 0.028, 40),
        root,
        coll,
    )
    collar.location = (0, plate.location.y - 0.022, 0)
    assign_mat(collar, mat_b)
    fr = new_obj("RC14_FocuserRing", make_cyl_y("RC14_FocuserRing", 0.070, 0.008, 32), root, coll)
    fr.location = (0, plate.location.y - 0.008, 0)
    assign_mat(fr, mat_s)

    for i, ang in enumerate((90, 210, 330)):
        a = math.radians(ang)
        r = W1 * 0.28
        fan = new_obj(f"RC14_Fan_{i}", make_cyl_y(f"RC14_Fan_{i}", 0.026, 0.008, 20), root, coll)
        fan.location = (r * math.cos(a), plate.location.y - 0.006, r * math.sin(a))
        assign_mat(fan, mat_s)

    # Joint blocks on rings
    def joints(prefix, y, w):
        ro = circum_r(w) * 0.92
        for i in range(8):
            a = math.radians(22.5 + i * 45)
            blk = new_obj(f"{prefix}_{i}", make_box(f"{prefix}_{i}", Vector((0.028, 0.032, 0.022))), root, coll)
            blk.location = (ro * math.cos(a), y, ro * math.sin(a))
            blk.rotation_euler = (0, -a, 0)
            assign_mat(blk, mat_s)

    joints("RC14_Joint1", y1, W1)
    joints("RC14_Joint2", y2, W2)
    joints("RC14_Joint3", y3, W3)

    # Short braces between ring1–ring2 (cell bay) — outer frame 支架
    idx = 0

    def truss(y_a, y_b, w_a, w_b, ang_a, ang_b, prefix="RC14_Truss"):
        nonlocal idx
        ra, rb = circum_r(w_a) * 0.92, circum_r(w_b) * 0.92
        p0 = Vector((ra * math.cos(ang_a), y_a, ra * math.sin(ang_a)))
        p1 = Vector((rb * math.cos(ang_b), y_b, rb * math.sin(ang_b)))
        mid = (p0 + p1) * 0.5
        d = p1 - p0
        tube = new_obj(
            f"{prefix}_{idx}",
            make_cyl_y(f"{prefix}_{idx}", 0.0075, d.length, 10),
            root,
            coll,
        )
        idx += 1
        tube.location = mid
        tube.rotation_mode = "QUATERNION"
        tube.rotation_quaternion = Vector((0, 1, 0)).rotation_difference(d.normalized())
        assign_mat(tube, mat_c)

    # Cell bay 1↔2: shorter V braces (支架 around cell)
    for i in range(8):
        a0 = math.radians(22.5 + i * 45)
        a1 = math.radians(22.5 + ((i + 1) % 8) * 45)
        truss(y1, y2, W1, W2, a0, a1, "RC14_CellTruss")
        truss(y1, y2, W1, W2, a1, a0, "RC14_CellTruss")

    # Main bay 2↔3: longer Serrurier
    idx = 0
    for i in range(8):
        a0 = math.radians(22.5 + i * 45)
        a1 = math.radians(22.5 + ((i + 1) % 8) * 45)
        truss(y2, y3, W2, W3, a0, a1, "RC14_Truss")
        truss(y2, y3, W2, W3, a1, a0, "RC14_Truss")

    # Secondary on ring3
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

    front_inner_r = circum_r(W3 * 0.78)
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
        vane.location = (rm * math.cos(ang), y3 + 0.003, rm * math.sin(ang))
        vane.rotation_euler = (0, -ang + math.radians(90), 0)
        assign_mat(vane, mat_b)

    # Dovetails spanning ring1–ring2 area (cell) onto ring2 — mount at ring2
    dov_len = GAP_12 + 0.18
    dov_y = y2 - GAP_12 * 0.35
    bottom = new_obj("RC14_Dovetail", make_dovetail("RC14_Dovetail", dov_len, 0.078, 0.018), root, coll)
    bottom.location = (0.0, dov_y, -0.208)
    bottom.rotation_euler = (math.radians(180), 0, 0)
    assign_mat(bottom, mat_b)
    top = new_obj("RC14_TopRail", make_dovetail("RC14_TopRail", dov_len * 0.95, 0.070, 0.016), root, coll)
    top.location = (0.0, dov_y, 0.208)
    assign_mat(top, mat_b)

    focuser = bpy.data.objects.new("RC14_FOCUSER", None)
    focuser.empty_display_type = "CIRCLE"
    focuser.empty_display_size = 0.05
    link_object(focuser, coll)
    focuser.parent = root
    focuser.location = (0.0, collar.location.y - 0.05, 0.0)
    focuser.rotation_euler = (0, 0, 0)

    # Legacy-friendly empty aliases (no mesh) so old scripts don't break hard
    for alias, target in (("RC14_FrontRing", r3), ("RC14_RearRing", r1)):
        # skip — names already Ring1/2/3; FrontRing would conflict if we also create mesh
        pass

    log("built Ring1–cell–Ring2–truss–Ring3")
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

    for n in ("RC14_Ring1", "RC14_Ring2", "RC14_Ring3", "RC14_RearCell"):
        o = bpy.data.objects.get(n)
        xs = [(o.matrix_local @ Vector(c)).x for c in o.bound_box]
        zs = [(o.matrix_local @ Vector(c)).z for c in o.bound_box]
        w = max(max(xs) - min(xs), max(zs) - min(zs))
        log(f"{n}: y={o.location.y:.3f} width~{w:.3f}")

    y1 = bpy.data.objects["RC14_Ring1"].location.y
    y2 = bpy.data.objects["RC14_Ring2"].location.y
    y3 = bpy.data.objects["RC14_Ring3"].location.y
    log(f"gap12={y2-y1:.3f} gap23={y3-y2:.3f}  (want 12 < 23)")
    assert bpy.data.objects.get("RC14_MidRing") is None
    log("no MidRing — good")

    bpy.ops.wm.save_as_mainfile(filepath=BLEND_PATH)
    log(f"saved {BLEND_PATH}")


if __name__ == "__main__":
    main()

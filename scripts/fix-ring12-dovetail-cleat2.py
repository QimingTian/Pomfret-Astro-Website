"""
1. Mount Losmandy on rings 1–2 (outside cell) so it no longer clips the cell;
   shift RC14_ROOT so the bar still seats in ME VersaPlate clamps.
2. Add Ring2 cleats like Ring3: rectangular, flush with ring band (no radial bulge);
   retarget bay-12/23 tubes to those cleats.
"""
from __future__ import annotations

import math

import bmesh
import bpy
from mathutils import Vector

BLEND = "/Users/tianqiming/Desktop/telescope-rc14.blend"


def log(msg: str) -> None:
    print(f"[fix12] {msg}")


def mesh_from_bm(name: str, bm: bmesh.types.BMesh) -> bpy.types.Mesh:
    mesh = bpy.data.meshes.new(name)
    bm.to_mesh(mesh)
    bm.free()
    mesh.update()
    return mesh


def make_box(name: str, size: tuple[float, float, float]) -> bpy.types.Mesh:
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    bmesh.ops.scale(bm, verts=bm.verts, vec=size)
    return mesh_from_bm(name, bm)


def make_bar(name: str, length: float, width: float, height: float) -> bpy.types.Mesh:
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    bmesh.ops.scale(bm, verts=bm.verts, vec=(width, length, height))
    return mesh_from_bm(name, bm)


def make_tube_between(name: str, a: Vector, b: Vector, radius: float, segs: int = 12) -> bpy.types.Mesh:
    bm = bmesh.new()
    depth = (b - a).length
    bmesh.ops.create_cone(
        bm, cap_ends=True, segments=segs, radius1=radius, radius2=radius, depth=depth
    )
    direction = (b - a).normalized()
    quat = direction.to_track_quat("Z", "Y")
    bmesh.ops.rotate(bm, verts=bm.verts, cent=(0, 0, 0), matrix=quat.to_matrix())
    bmesh.ops.translate(bm, verts=bm.verts, vec=(a + b) * 0.5)
    return mesh_from_bm(name, bm)


def replace_mesh(obj: bpy.types.Object, mesh: bpy.types.Mesh) -> None:
    old = obj.data
    obj.data = mesh
    if old and old.users == 0:
        bpy.data.meshes.remove(old)


def ring_apothems(obj: bpy.types.Object) -> tuple[float, float, float]:
    """Return (inner_apothem, outer_apothem, y_thickness) from mesh face centers."""
    import bmesh as bm_mod

    bm = bm_mod.new()
    bm.from_mesh(obj.data)
    bm.faces.ensure_lookup_table()
    outer, inner = [], []
    for f in bm.faces:
        c = f.calc_center_median()
        n = f.normal
        if abs(n.y) > 0.1 or abs(c.y) > 0.002:
            continue
        r = math.hypot(c.x, c.z)
        # outward normals point away from axis
        if n.x * c.x + n.z * c.z > 0:
            outer.append(r)
        else:
            inner.append(r)
    bm.free()
    ys = [v.co.y for v in obj.data.vertices]
    return (sum(inner) / len(inner), sum(outer) / len(outer), max(ys) - min(ys))


def ensure_obj(name: str, mesh: bpy.types.Mesh, root, coll, mat) -> bpy.types.Object:
    if name in bpy.data.objects:
        obj = bpy.data.objects[name]
        replace_mesh(obj, mesh)
    else:
        obj = bpy.data.objects.new(name, mesh)
        obj.parent = root
        coll.objects.link(obj)
    if mat:
        if obj.data.materials:
            obj.data.materials[0] = mat
        else:
            obj.data.materials.append(mat)
    return obj


def main() -> None:
    bpy.ops.wm.open_mainfile(filepath=BLEND)
    root = bpy.data.objects["RC14_ROOT"]
    coll = bpy.data.collections.get("03_RC14") or root.users_collection[0]
    mat_b = bpy.data.materials.get("RC14_Black")
    mat_c = bpy.data.materials.get("RC14_Carbon")
    mat_s = bpy.data.materials.get("RC14_Silver")

    r1 = bpy.data.objects["RC14_Ring1"]
    r2 = bpy.data.objects["RC14_Ring2"]
    r3 = bpy.data.objects["RC14_Ring3"]
    y1, y2, y3 = r1.location.y, r2.location.y, r3.location.y

    # --- Ring2 cleats (cardinal flats), flush with band ---
    i2, o2, t2 = ring_apothems(r2)
    band2 = o2 - i2
    mid2 = (o2 + i2) * 0.5
    log(f"ring2 apothem inner={i2:.4f} outer={o2:.4f} band={band2:.4f}")

    cleat_y_size = max(0.02, t2 * 0.9)
    cleat_tangent = 0.070
    # On face toward ring3 (forward), like ring3 cleats face ring2
    fwd_face_y = y2 + t2 * 0.5
    cleat2_y = fwd_face_y + cleat_y_size * 0.5

    cleat2: list[bpy.types.Object] = []
    for i, ang_deg in enumerate([0.0, 90.0, 180.0, 270.0]):
        ang = math.radians(ang_deg)
        nx, nz = math.cos(ang), math.sin(ang)
        loc = Vector((mid2 * nx, cleat2_y, mid2 * nz))
        name = f"RC14_Cleat2_{i}"
        obj = ensure_obj(name, make_box(name, (band2, cleat_y_size, cleat_tangent)), root, coll, mat_b)
        obj.location = loc
        obj.rotation_euler = (0.0, -ang, 0.0)
        cleat2.append(obj)
        log(f"{name} loc=({loc.x:.4f},{loc.y:.4f},{loc.z:.4f})")

    # Keep / refresh ring3 cleats flush (already correct, but re-read ends)
    cleat3 = [bpy.data.objects[f"RC14_Cleat3_{i}"] for i in range(4)]

    # --- Rebuild tubes ---
    tube_r = 0.012
    for o in list(bpy.data.objects):
        if o.name.startswith("RC14_Truss_") or o.name.startswith("RC14_CellTruss_"):
            bpy.data.objects.remove(o, do_unlink=True)

    # Bay 23: each Cleat2 → two neighboring Cleat3 (45° offset)
    # Cleat2: 0,90,180,270 → Cleat3 at 45,135,225,315 (indices 0,1,2,3)
    hub_to_cleats = [(0, 3), (0, 1), (1, 2), (2, 3)]  # same pairing as before
    ti = 0
    for hi, (ca, cb) in enumerate(hub_to_cleats):
        hub = Vector(cleat2[hi].location)
        for ci in (ca, cb):
            end = Vector(cleat3[ci].location)
            name = f"RC14_Truss_{ti}"
            obj = bpy.data.objects.new(name, make_tube_between(name, hub, end, tube_r))
            obj.parent = root
            coll.objects.link(obj)
            if mat_c:
                obj.data.materials.append(mat_c)
            ti += 1
    log(f"rebuilt {ti} bay23 tubes cleat2→cleat3")

    # Bay 12: ring1 diagonal docks → Cleat2 cardinal (existing pattern)
    # Ring1 dock radius ~ mid of ring1 band on diagonal flats
    i1, o1, t1 = ring_apothems(r1)
    mid1 = (o1 + i1) * 0.5
    # Diagonals 45,135,225,315 — for V from each Cleat2
    # Cleat2_0 (0°) ← from ring1 at 45° and 315°
    # Cleat2_1 (90°) ← 45 and 135
    # etc. Same hub_to_cleats inverted: each cleat2 from two ring1 diagonal points
    r1_angles = [45.0, 135.0, 225.0, 315.0]
    r1_pts = [
        Vector((mid1 * math.cos(math.radians(a)), y1, mid1 * math.sin(math.radians(a))))
        for a in r1_angles
    ]
    # pairings: cleat2 i gets r1 indices from hub_to_cleats
    ci = 0
    for hi, (a, b) in enumerate(hub_to_cleats):
        hub = Vector(cleat2[hi].location)
        for ri in (a, b):
            name = f"RC14_CellTruss_{ci}"
            obj = bpy.data.objects.new(name, make_tube_between(name, r1_pts[ri], hub, tube_r))
            obj.parent = root
            coll.objects.link(obj)
            if mat_c:
                obj.data.materials.append(mat_c)
            ci += 1
    log(f"rebuilt {ci} bay12 tubes ring1→cleat2")

    # --- Losmandy on rings 1–2 (outside cell, on outer flats) ---
    outer = o2  # 0.25 across-flats outer
    dov_h = 0.016
    dov_w = 0.078
    dov_len = abs(y2 - y1) + 0.02  # slightly past ring centers onto ring faces
    dov_y = (y1 + y2) * 0.5
    # Between ring bottom flat (z=-outer) and plate: bar occupies z in [-outer-dov_h, -outer]
    dov_z = -(outer + dov_h * 0.5)

    dov = ensure_obj(
        "RC14_Dovetail",
        make_bar("RC14_Dovetail", dov_len, dov_w, dov_h),
        root,
        coll,
        mat_s,
    )
    dov.location = (0.0, dov_y, dov_z)
    dov.rotation_euler = (0.0, 0.0, 0.0)
    log(f"dovetail on rings12 loc={tuple(round(v,4) for v in dov.location)} len={dov_len:.3f}")

    # Top rail mirror on +Z
    if "RC14_TopRail" in bpy.data.objects:
        top = ensure_obj(
            "RC14_TopRail",
            make_bar("RC14_TopRail", dov_len * 0.95, 0.070, dov_h),
            root,
            coll,
            mat_s,
        )
        top.location = (0.0, dov_y, outer + dov_h * 0.5)
        top.rotation_euler = (0.0, 0.0, 0.0)

    # Shift ROOT so dovetail seats in clamp channel like C14
    # plate_y = root.loc.y - z   (with ~90° X on root)
    # Against-plate face of bar at z = -(outer + dov_h) = most negative z
    z_plate_face = -(outer + dov_h)
    z_jaw_face = -outer
    # Want plate_y(z_plate_face) ≈ -0.011, plate_y(z_jaw_face) ≈ -0.027
    target_plate_y = -0.011
    new_root_y = target_plate_y + z_plate_face  # since plate_y = root_y - z → root_y = plate_y + z
    # z_plate_face is negative: root_y = -0.011 + (-0.266) = -0.277
    old_y = root.location.y
    root.location.y = new_root_y
    log(f"RC14_ROOT.y {old_y:.4f} → {new_root_y:.4f} (seat dovetail in clamps)")

    # Verify
    plate = bpy.data.objects["ME_VersaPlate"]
    ys_p, xs_p, zs_p = [], [], []
    for v in dov.data.vertices:
        pl = plate.matrix_world.inverted() @ (dov.matrix_world @ v.co)
        xs_p.append(pl.x)
        ys_p.append(pl.y)
        zs_p.append(pl.z)
    log(
        f"dovetail plate X=[{min(xs_p):.4f},{max(xs_p):.4f}] "
        f"Y=[{min(ys_p):.4f},{max(ys_p):.4f}] Z=[{min(zs_p):.4f},{max(zs_p):.4f}]"
    )

    # Cleat2 flush check
    for obj in cleat2:
        ang = -obj.rotation_euler.y
        nx, nz = math.cos(ang), math.sin(ang)
        nd = []
        for v in obj.data.vertices:
            rl = Vector(obj.location) + obj.rotation_euler.to_matrix() @ Vector(v.co)
            nd.append(rl.x * nx + rl.z * nz)
        log(f"{obj.name} normal [{min(nd):.4f},{max(nd):.4f}] expect [{i2:.4f},{o2:.4f}]")

    # Confirm no cell overlap in Z with dovetail
    cell = bpy.data.objects["RC14_RearCell"]
    inv = root.matrix_world.inverted()
    cell_z = [(inv @ (cell.matrix_world @ v.co)).z for v in cell.data.vertices]
    dov_z_span = [dov.location.z - dov_h * 0.5, dov.location.z + dov_h * 0.5]
    log(f"cell Z=[{min(cell_z):.4f},{max(cell_z):.4f}] dov Z=[{dov_z_span[0]:.4f},{dov_z_span[1]:.4f}]")

    bpy.ops.wm.save_as_mainfile(filepath=BLEND)
    log("saved " + BLEND)


if __name__ == "__main__":
    main()

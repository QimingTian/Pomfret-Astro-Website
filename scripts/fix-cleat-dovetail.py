"""
Fix RC14 cleats + Losmandy dovetail:

1. Cleats: radial width = ring3 band width; sit flush in the octagon
   wall (not sticking past the outer flat).
2. Dovetail: match ME VersaPlate clamp channel like C14_Dovetail
   (width 0.078 between jaws at ±0.041, height seated in Y -0.011..-0.027).
"""
from __future__ import annotations

import math

import bmesh
import bpy
from mathutils import Matrix, Vector

BLEND = "/Users/tianqiming/Desktop/telescope-rc14.blend"


def log(msg: str) -> None:
    print(f"[fix] {msg}")


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


def make_dovetail_bar(name: str, length: float, width: float, height: float) -> bpy.types.Mesh:
    """Rectangular Losmandy bar matching C14_Dovetail (centered on origin in Z)."""
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
    # default cone along Z; aim along (b-a), center at midpoint
    direction = (b - a).normalized()
    quat = direction.to_track_quat("Z", "Y")
    bmesh.ops.rotate(bm, verts=bm.verts, cent=(0, 0, 0), matrix=quat.to_matrix())
    mid = (a + b) * 0.5
    bmesh.ops.translate(bm, verts=bm.verts, vec=mid)
    return mesh_from_bm(name, bm)


def replace_mesh(obj: bpy.types.Object, mesh: bpy.types.Mesh) -> None:
    old = obj.data
    obj.data = mesh
    if old and old.users == 0:
        bpy.data.meshes.remove(old)


def main() -> None:
    bpy.ops.wm.open_mainfile(filepath=BLEND)
    root = bpy.data.objects["RC14_ROOT"]
    coll = bpy.data.collections.get("03_RC14") or root.users_collection[0]
    mat_b = bpy.data.materials.get("RC14_Black")
    mat_c = bpy.data.materials.get("RC14_Carbon")
    mat_s = bpy.data.materials.get("RC14_Silver")

    r3 = bpy.data.objects["RC14_Ring3"]
    y3 = r3.location.y
    ys = [v.co.y for v in r3.data.vertices]
    ring3_thick = max(ys) - min(ys)
    aft_face_y = y3 - ring3_thick * 0.5

    # Across-flats outer / inner from ring mesh face centers
    outer_apothem = 0.25
    inner_apothem = 0.225
    band = outer_apothem - inner_apothem  # 0.025 — cleat radial width
    mid_apothem = (outer_apothem + inner_apothem) * 0.5  # 0.2375
    log(f"ring3 band={band:.4f} mid_apothem={mid_apothem:.4f} aft_y={aft_face_y:.4f}")

    # Cleat optical-axis thickness (sticks toward ring2 from aft face)
    cleat_y_size = 0.024
    cleat_tangent = 0.070  # along the octagon flat
    cleat_center_y = aft_face_y - cleat_y_size * 0.5

    # Four flats at 45° + n*90° (NE, NW, SW, SE) — where V-truss docks
    flat_angles = [45.0, 135.0, 225.0, 315.0]
    cleat_objs: list[bpy.types.Object] = []

    for i, ang_deg in enumerate(flat_angles):
        ang = math.radians(ang_deg)
        # Flat outward normal in XZ
        nx, nz = math.cos(ang), math.sin(ang)
        loc = Vector((mid_apothem * nx, cleat_center_y, mid_apothem * nz))

        name = f"RC14_Cleat3_{i}"
        mesh = make_box(name, (band, cleat_y_size, cleat_tangent))
        if name in bpy.data.objects:
            obj = bpy.data.objects[name]
            replace_mesh(obj, mesh)
        else:
            obj = bpy.data.objects.new(name, mesh)
            coll.objects.link(obj)
            obj.parent = root

        obj.location = loc
        # Local +X = radial (outward normal). Rot about Y by -(90 - ang) = ang - 90
        # For ang=45°: rot Y = -45° maps local +X → (cos45, 0, -sin45)? 
        # R_y(θ): x' = x c + z s, z' = -x s + z c
        # Want local (1,0,0) → (nx, 0, nz) = (cos ang, 0, sin ang)
        # x' = c = cos ang, z' = -s = sin ang ⇒ s = -sin ang ⇒ θ = -ang
        # For ang=45: θ=-45: (1,0,0)→(0.707, 0, 0.707)? z'=-s=sin45=0.707 YES if s=-sin45, θ=-45.
        # R_y(-45): c=√2/2, s=-√2/2; x'=c=0.707, z'=-s=0.707. Correct for NE.
        obj.rotation_euler = (0.0, -ang, 0.0)
        obj.scale = (1, 1, 1)
        if mat_b:
            if obj.data.materials:
                obj.data.materials[0] = mat_b
            else:
                obj.data.materials.append(mat_b)
        cleat_objs.append(obj)
        log(f"{name} loc=({loc.x:.4f},{loc.y:.4f},{loc.z:.4f}) rotY={-ang_deg:.1f}")

    # --- Rebuild main bay trusses: ring2 cardinal hubs → ring3 cleats (V pairs) ---
    y2 = bpy.data.objects["RC14_Ring2"].location.y
    # Ring2 attach radius (from existing tube low ends ~0.249)
    r2_hub = 0.249
    hub_angles = [0.0, 90.0, 180.0, 270.0]  # cardinal on ring2
    # Each hub connects to two neighboring 45° cleats
    # hub 0° → cleats at 45° and 315° (indices 0 and 3)
    # hub 90° → cleats 45° and 135° (0 and 1)
    # hub 180° → 135° and 225° (1 and 2)
    # hub 270° → 225° and 315° (2 and 3)
    hub_to_cleats = [(0, 3), (0, 1), (1, 2), (2, 3)]

    tube_r = 0.012
    # Delete old main trusses
    for o in list(bpy.data.objects):
        if o.name.startswith("RC14_Truss_"):
            bpy.data.objects.remove(o, do_unlink=True)

    ti = 0
    for hi, (c_a, c_b) in enumerate(hub_to_cleats):
        hang = math.radians(hub_angles[hi])
        hub = Vector((r2_hub * math.cos(hang), y2, r2_hub * math.sin(hang)))
        for ci in (c_a, c_b):
            end = Vector(cleat_objs[ci].location)
            name = f"RC14_Truss_{ti}"
            mesh = make_tube_between(name, hub, end, tube_r)
            obj = bpy.data.objects.new(name, mesh)
            obj.parent = root
            coll.objects.link(obj)
            if mat_c:
                obj.data.materials.append(mat_c)
            ti += 1
    log(f"rebuilt {ti} main truss tubes → cleat centers")

    # --- Losmandy dovetail: seat in VersaPlate clamps like C14 ---
    # C14: width 0.078, height 0.016 centered, loc z=-0.208, rot 0
    # Clamp channel: X ±0.041, Y -0.039..-0.011
    y1 = bpy.data.objects["RC14_Ring1"].location.y
    dov_len = abs(y2 - y1) + 0.04  # span cell bay with a little overhang
    dov_y = (y1 + y2) * 0.5
    dov_w, dov_h = 0.078, 0.016
    dov_z = -0.208

    dov_mesh = make_dovetail_bar("RC14_Dovetail", dov_len, dov_w, dov_h)
    if "RC14_Dovetail" in bpy.data.objects:
        dov = bpy.data.objects["RC14_Dovetail"]
        replace_mesh(dov, dov_mesh)
    else:
        dov = bpy.data.objects.new("RC14_Dovetail", dov_mesh)
        dov.parent = root
        coll.objects.link(dov)
    dov.location = (0.0, dov_y, dov_z)
    dov.rotation_euler = (0.0, 0.0, 0.0)
    if mat_s:
        if dov.data.materials:
            dov.data.materials[0] = mat_s
        else:
            dov.data.materials.append(mat_s)
    log(f"dovetail loc={tuple(round(v,4) for v in dov.location)} size=({dov_w},{dov_len},{dov_h}) rot=0")

    # Verify seating in plate space
    plate = bpy.data.objects["ME_VersaPlate"]
    ys_p, xs_p = [], []
    for v in dov.data.vertices:
        pl = plate.matrix_world.inverted() @ (dov.matrix_world @ v.co)
        ys_p.append(pl.y)
        xs_p.append(pl.x)
    log(
        f"dovetail plate X=[{min(xs_p):.4f},{max(xs_p):.4f}] "
        f"Y=[{min(ys_p):.4f},{max(ys_p):.4f}] "
        f"(channel X±0.041 Y -0.039..-0.011)"
    )

    # Verify cleat flush with band
    for obj in cleat_objs:
        ndists = []
        ang = -obj.rotation_euler.y  # stored as -ang earlier... rotation_euler.y = -ang
        # outward normal from rotation: local +X direction
        nx = math.cos(-obj.rotation_euler.y)  # = cos(ang)
        # Actually rot_euler.y = -ang, so ang_stored = -rot.y
        ang = -obj.rotation_euler.y
        nx, nz = math.cos(ang), math.sin(ang)
        for v in obj.data.vertices:
            rl = Vector(obj.location) + obj.rotation_euler.to_matrix() @ Vector(v.co)
            ndists.append(rl.x * nx + rl.z * nz)
        log(
            f"{obj.name} normal-dist [{min(ndists):.4f},{max(ndists):.4f}] "
            f"expect [{inner_apothem:.4f},{outer_apothem:.4f}]"
        )

    bpy.ops.wm.save_as_mainfile(filepath=BLEND)
    log("saved " + BLEND)


if __name__ == "__main__":
    main()

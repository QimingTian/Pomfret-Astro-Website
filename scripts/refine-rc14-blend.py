"""
Refine telescope-rc14.blend:
- Rebuild RC14 closer to classic truss RC reference
- Mount IMAGING_TRAIN coaxial with optical axis (no 90° diagonal)
"""
from __future__ import annotations

import math
import sys

import bmesh
import bpy
from mathutils import Matrix, Vector

BLEND_PATH = "/Users/tianqiming/Desktop/telescope-rc14.blend"


def log(msg: str) -> None:
    print(f"[RC14-fix] {msg}", flush=True)


def link_object(obj: bpy.types.Object, coll: bpy.types.Collection) -> None:
    for c in list(obj.users_collection):
        c.objects.unlink(obj)
    coll.objects.link(obj)


def get_mat(preferred: str) -> bpy.types.Material:
    for name in (preferred, "RC14_Black", "C14Black", "AnodizedBlack", "PierBlack"):
        mat = bpy.data.materials.get(name)
        if mat is not None:
            if name == preferred:
                return mat
            copy = mat.copy()
            copy.name = preferred
            return copy
    mat = bpy.data.materials.new(preferred)
    mat.diffuse_color = (0.02, 0.02, 0.02, 1.0)
    return mat


def assign_mat(obj: bpy.types.Object, mat: bpy.types.Material) -> None:
    if obj.data and hasattr(obj.data, "materials"):
        obj.data.materials.clear()
        obj.data.materials.append(mat)


def mesh_from_bmesh(name: str, bm: bmesh.types.BMesh) -> bpy.types.Mesh:
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    mesh = bpy.data.meshes.new(name)
    bm.to_mesh(mesh)
    bm.free()
    mesh.update()
    return mesh


def new_mesh(name: str, mesh: bpy.types.Mesh, parent: bpy.types.Object, coll: bpy.types.Collection) -> bpy.types.Object:
    obj = bpy.data.objects.new(name, mesh)
    link_object(obj, coll)
    obj.parent = parent
    return obj


def hex_points(r: float, y: float, n: int = 6):
    # flat-top hex: start at 30° so flats are vertical/horizontal-ish in XZ
    return [
        (r * math.cos(math.radians(30 + i * (360 / n))), y, r * math.sin(math.radians(30 + i * (360 / n))))
        for i in range(n)
    ]


def make_hex_annulus(name: str, outer_r: float, inner_r: float, thickness: float, sides: int = 6) -> bpy.types.Mesh:
    """Clean hexagonal annulus (CNC plate without holes yet)."""
    bm = bmesh.new()
    y0, y1 = -thickness * 0.5, thickness * 0.5
    n = sides
    outer0 = [bm.verts.new(p) for p in hex_points(outer_r, y0, n)]
    outer1 = [bm.verts.new(p) for p in hex_points(outer_r, y1, n)]
    inner0 = [bm.verts.new(p) for p in hex_points(inner_r, y0, n)]
    inner1 = [bm.verts.new(p) for p in hex_points(inner_r, y1, n)]

    def bridge(a, b):
        for i in range(len(a)):
            j = (i + 1) % len(a)
            bm.faces.new([a[i], a[j], b[j], b[i]])

    bridge(outer0, outer1)
    bridge(inner1, inner0)
    for i in range(n):
        j = (i + 1) % n
        bm.faces.new([outer0[i], outer0[j], inner0[j], inner0[i]])
        bm.faces.new([outer1[j], outer1[i], inner1[i], inner1[j]])
    return mesh_from_bmesh(name, bm)


def boolean_cut_oblong_holes(
    host: bpy.types.Object,
    outer_r: float,
    thickness: float,
    hole_rx: float,
    hole_rz: float,
    sides: int = 6,
) -> None:
    """Punch oblong through-holes in a hex ring using Boolean EXACT."""
    for i in range(sides):
        a = math.radians(30 + i * (360 / sides))
        cx = outer_r * 0.72 * math.cos(a)
        cz = outer_r * 0.72 * math.sin(a)
        # Elongated cutter along local Y (through plate)
        bm = bmesh.new()
        bmesh.ops.create_cone(
            bm,
            cap_ends=True,
            segments=16,
            radius1=1.0,
            radius2=1.0,
            depth=thickness * 3.0,
        )
        # Scale to oblong, rotate cylinder from Z to Y, then align ellipse axes
        bmesh.ops.scale(bm, verts=bm.verts, vec=(hole_rx, hole_rz, 1.0))
        bmesh.ops.rotate(bm, verts=bm.verts, cent=(0, 0, 0), matrix=Matrix.Rotation(math.radians(90), 3, "X"))
        # Rotate around Y so oblong tangential/radial matches flat
        bmesh.ops.rotate(bm, verts=bm.verts, cent=(0, 0, 0), matrix=Matrix.Rotation(a, 3, "Y"))
        cutter_mesh = mesh_from_bmesh(f"_cut_{host.name}_{i}", bm)
        cutter = bpy.data.objects.new(f"_cut_{host.name}_{i}", cutter_mesh)
        bpy.context.scene.collection.objects.link(cutter)
        cutter.parent = host
        cutter.location = (cx, 0.0, cz)
        mw = cutter.matrix_world.copy()
        cutter.parent = None
        cutter.matrix_world = mw

        mod = host.modifiers.new(name=f"Cut{i}", type="BOOLEAN")
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
            log(f"boolean cut fail {host.name}#{i}: {exc}")
            if mod.name in host.modifiers:
                host.modifiers.remove(mod)
        bpy.data.objects.remove(cutter, do_unlink=True)


def make_tube_y(name: str, outer_r: float, inner_r: float, depth: float, segments: int = 48) -> bpy.types.Mesh:
    bm = bmesh.new()
    y0, y1 = -depth * 0.5, depth * 0.5

    def ring(r, y):
        return [
            bm.verts.new(
                (r * math.cos(2 * math.pi * i / segments), y, r * math.sin(2 * math.pi * i / segments))
            )
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
    return mesh_from_bmesh(name, bm)


def make_cylinder_y(name: str, radius: float, depth: float, segments: int = 48, capped: bool = True) -> bpy.types.Mesh:
    bm = bmesh.new()
    bmesh.ops.create_cone(
        bm,
        cap_ends=capped,
        cap_tris=False,
        segments=segments,
        radius1=radius,
        radius2=radius,
        depth=depth,
    )
    bmesh.ops.rotate(bm, verts=bm.verts, cent=(0, 0, 0), matrix=Matrix.Rotation(math.radians(90), 3, "X"))
    return mesh_from_bmesh(name, bm)


def make_box(name: str, size: Vector) -> bpy.types.Mesh:
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    bmesh.ops.scale(bm, verts=bm.verts, vec=size)
    return mesh_from_bmesh(name, bm)


def make_dovetail(name: str, length: float, width: float, height: float) -> bpy.types.Mesh:
    bm = bmesh.new()
    w, top_w = width * 0.5, width * 0.38
    y0, y1 = -length * 0.5, length * 0.5
    profile = [(-w, 0.0), (w, 0.0), (top_w, height), (-top_w, height)]
    v0 = [bm.verts.new((x, y0, z)) for x, z in profile]
    v1 = [bm.verts.new((x, y1, z)) for x, z in profile]
    bm.faces.new(v0)
    bm.faces.new(list(reversed(v1)))
    for i in range(4):
        j = (i + 1) % 4
        bm.faces.new([v0[i], v0[j], v1[j], v1[i]])
    return mesh_from_bmesh(name, bm)


def make_primary_mirror_dish(name: str, radius: float, sag: float, segments: int = 48) -> bpy.types.Mesh:
    """Shallow concave dish facing +Y (toward secondary)."""
    bm = bmesh.new()
    # Disc in XZ, slight bowl along -Y at center
    center = bm.verts.new((0, -sag, 0))
    ring = [
        bm.verts.new((radius * math.cos(2 * math.pi * i / segments), 0.0, radius * math.sin(2 * math.pi * i / segments)))
        for i in range(segments)
    ]
    for i in range(segments):
        j = (i + 1) % segments
        bm.faces.new([center, ring[j], ring[i]])
    return mesh_from_bmesh(name, bm)


def delete_rc14_meshes(keep_names: set[str]) -> None:
    to_del = [
        o
        for o in list(bpy.data.objects)
        if o.name.startswith("RC14_") and o.name not in keep_names
    ]
    log(f"Deleting {len(to_del)} old RC14 parts...")
    for o in to_del:
        bpy.data.objects.remove(o, do_unlink=True)


def build_rc14(root: bpy.types.Object, coll: bpy.types.Collection) -> bpy.types.Object:
    mat_black = get_mat("RC14_Black")
    mat_carbon = get_mat("RC14_Carbon")
    mat_metal = get_mat("RC14_Metal")
    mat_mirror = get_mat("RC14_Mirror")
    mat_mirror.diffuse_color = (0.05, 0.05, 0.06, 1.0)

    # Classic GSO/AT-style proportions (meters)
    rear_outer = 0.268
    rear_inner = 0.188
    front_outer = 0.230
    front_inner = 0.178
    mid_outer = 0.268
    mid_inner = 0.200
    secondary_r = 0.082
    aperture = 0.355

    # Layout along +Y = front (secondary), -Y = rear (camera)
    y_rear_plate = -0.38
    y_rear_cell = -0.46
    y_mid = 0.02
    y_front = 0.50
    y_secondary = 0.52
    y_baffle_center = -0.10
    baffle_len = 0.42

    def add_ring(name: str, outer: float, inner: float, thick: float, y: float, hole_rx: float, hole_rz: float):
        # Build and boolean at identity, then parent — keeps cuts in mesh local space
        mesh = make_hex_annulus(name, outer, inner, thick)
        obj = bpy.data.objects.new(name, mesh)
        bpy.context.scene.collection.objects.link(obj)
        boolean_cut_oblong_holes(obj, outer, thick, hole_rx, hole_rz)
        link_object(obj, coll)
        obj.parent = root
        obj.location = (0, y, 0)
        obj.rotation_euler = (0, 0, 0)
        assign_mat(obj, mat_black)
        return obj

    # --- Rear CNC plate ---
    add_ring("RC14_RearRing", rear_outer, rear_inner, 0.018, y_rear_plate, 0.038, 0.028)

    # Primary cell housing behind plate
    rear_cell = new_mesh(
        "RC14_RearCell",
        make_tube_y("RC14_RearCell", rear_outer * 0.88, aperture * 0.28, 0.11, 64),
        root,
        coll,
    )
    rear_cell.location = (0, y_rear_cell, 0)
    assign_mat(rear_cell, mat_black)

    # Primary mirror dish (visible looking into rear)
    mirror = new_mesh(
        "RC14_PrimaryMirror",
        make_primary_mirror_dish("RC14_PrimaryMirror", aperture * 0.48, sag=0.012, segments=64),
        root,
        coll,
    )
    mirror.location = (0, y_rear_cell + 0.02, 0)
    assign_mat(mirror, mat_mirror)

    # Long primary baffle (signature of the reference)
    baffle = new_mesh(
        "RC14_PrimaryBaffle",
        make_tube_y("RC14_PrimaryBaffle", aperture * 0.20, aperture * 0.155, baffle_len, 48),
        root,
        coll,
    )
    baffle.location = (0, y_baffle_center, 0)
    assign_mat(baffle, mat_black)

    # Focuser collar on optical axis at rear
    collar = new_mesh(
        "RC14_FocuserCollar",
        make_tube_y("RC14_FocuserCollar", 0.062, 0.046, 0.032, 48),
        root,
        coll,
    )
    collar.location = (0, y_rear_cell - 0.07, 0)
    assign_mat(collar, mat_metal)

    # Cooling fans on rear cell
    for i, ang in enumerate((20, 140, 260)):
        fan = new_mesh(
            f"RC14_Fan_{i}",
            make_cylinder_y(f"RC14_Fan_{i}", 0.016, 0.01, 16),
            root,
            coll,
        )
        a = math.radians(ang)
        fan.location = (0.11 * math.cos(a), y_rear_cell - 0.055, 0.11 * math.sin(a))
        assign_mat(fan, mat_metal)

    # Mid ring (Serrurier center)
    add_ring("RC14_MidRing", mid_outer, mid_inner, 0.014, y_mid, 0.036, 0.026)

    # Front ring
    add_ring("RC14_FrontRing", front_outer, front_inner, 0.012, y_front, 0.032, 0.024)

    # Thin secondary support ring just ahead
    add_ring("RC14_FrontRing2", front_outer * 0.98, front_inner, 0.007, y_front + 0.028, 0.028, 0.020)

    # Corner junction blocks for truss sockets
    def add_block(name: str, y: float, r: float, ang: float):
        blk = new_mesh(name, make_box(name, Vector((0.028, 0.032, 0.028))), root, coll)
        blk.location = (r * math.cos(ang), y, r * math.sin(ang))
        blk.rotation_euler = (0, -ang, 0)
        assign_mat(blk, mat_metal)
        return blk

    for i in range(6):
        a = math.radians(30 + i * 60)
        add_block(f"RC14_BlockR_{i}", y_rear_plate, rear_outer * 0.92, a)
        add_block(f"RC14_BlockM_{i}", y_mid, mid_outer * 0.92, a)
        add_block(f"RC14_BlockF_{i}", y_front, front_outer * 0.92, a)

    # Serrurier trusses: V pairs rear↔mid and mid↔front
    idx = 0

    def add_truss(y_a, y_b, r_a, r_b, ang_a, ang_b):
        nonlocal idx
        p0 = Vector((r_a * math.cos(ang_a), y_a, r_a * math.sin(ang_a)))
        p1 = Vector((r_b * math.cos(ang_b), y_b, r_b * math.sin(ang_b)))
        midp = (p0 + p1) * 0.5
        direction = p1 - p0
        length = direction.length
        tube = new_mesh(
            f"RC14_Truss_{idx}",
            make_cylinder_y(f"RC14_Truss_{idx}", 0.0075, length, 12),
            root,
            coll,
        )
        idx += 1
        tube.location = midp
        tube.rotation_mode = "QUATERNION"
        tube.rotation_quaternion = Vector((0, 1, 0)).rotation_difference(direction.normalized())
        assign_mat(tube, mat_carbon)

    for i in range(6):
        a0 = math.radians(30 + i * 60)
        a1 = math.radians(30 + ((i + 1) % 6) * 60)
        # Crossed V: each rear corner → two mid neighbors style
        add_truss(y_rear_plate, y_mid, rear_outer * 0.92, mid_outer * 0.92, a0, a1)
        add_truss(y_rear_plate, y_mid, rear_outer * 0.92, mid_outer * 0.92, a1, a0)
        add_truss(y_mid, y_front, mid_outer * 0.92, front_outer * 0.92, a0, a1)
        add_truss(y_mid, y_front, mid_outer * 0.92, front_outer * 0.92, a1, a0)

    # Secondary housing
    sec = new_mesh(
        "RC14_Secondary",
        make_tube_y("RC14_Secondary", secondary_r, secondary_r * 0.45, 0.075, 48),
        root,
        coll,
    )
    sec.location = (0, y_secondary, 0)
    assign_mat(sec, mat_black)

    sec_cap = new_mesh(
        "RC14_SecondaryCap",
        make_cylinder_y("RC14_SecondaryCap", secondary_r * 0.92, 0.012, 32),
        root,
        coll,
    )
    sec_cap.location = (0, y_secondary + 0.04, 0)
    assign_mat(sec_cap, mat_black)

    # Four-vane spider — thin blades spanning secondary to front ring
    for i in range(4):
        ang = math.radians(i * 90 + 45)  # match typical X spider on flats
        span = front_inner - secondary_r * 0.85
        vane = new_mesh(
            f"RC14_Spider_{i}",
            make_box(f"RC14_Spider_{i}", Vector((0.0018, 0.012, span))),
            root,
            coll,
        )
        r_mid = (secondary_r * 0.9 + front_inner) * 0.5
        vane.location = (r_mid * math.cos(ang), y_front + 0.006, r_mid * math.sin(ang))
        vane.rotation_euler = (0, -ang + math.radians(90), 0)
        assign_mat(vane, mat_metal)

    # Dovetails
    dovetail = new_mesh(
        "RC14_Dovetail",
        make_dovetail("RC14_Dovetail", length=0.42, width=0.078, height=0.018),
        root,
        coll,
    )
    dovetail.location = (0.0, -0.05, -0.215)
    dovetail.rotation_euler = (math.radians(180), 0, 0)
    assign_mat(dovetail, mat_metal)

    top_rail = new_mesh(
        "RC14_TopRail",
        make_dovetail("RC14_TopRail", length=0.38, width=0.070, height=0.016),
        root,
        coll,
    )
    top_rail.location = (0.0, 0.02, 0.215)
    assign_mat(top_rail, mat_metal)

    # Focuser empty — coaxial, behind collar along -Y
    focuser = bpy.data.objects.get("RC14_FOCUSER")
    if focuser is None:
        focuser = bpy.data.objects.new("RC14_FOCUSER", None)
        focuser.empty_display_type = "CIRCLE"
        focuser.empty_display_size = 0.05
        link_object(focuser, coll)
        focuser.parent = root
    focuser.location = (0.0, collar.location.y - 0.045, 0.0)
    focuser.rotation_euler = (0.0, 0.0, 0.0)
    focuser.scale = (1, 1, 1)

    log("RC14 rebuilt")
    return focuser


def fix_imaging_train(focuser: bpy.types.Object) -> None:
    it = bpy.data.objects.get("IMAGING_TRAIN")
    if not it:
        log("WARNING: IMAGING_TRAIN missing")
        return
    it.parent = focuser
    it.matrix_parent_inverse.identity()
    # Coaxial: IT local Y = optical axis. Children already sit along -Y (rear).
    # Do NOT apply -90° — that folded the train like a star diagonal.
    it.location = (0.0, -0.02, 0.0)
    it.rotation_euler = (0.0, 0.0, 0.0)
    it.scale = (1, 1, 1)
    bpy.context.view_layer.update()

    zwo = bpy.data.objects.get("IT_ZWO_Body")
    rear = bpy.data.objects.get("RC14_RearCell")
    sec = bpy.data.objects.get("RC14_Secondary")
    if zwo and rear and sec:
        stack = Vector(zwo.matrix_world.translation) - Vector(focuser.matrix_world.translation)
        optical = Vector(sec.matrix_world.translation) - Vector(rear.matrix_world.translation)
        if stack.length > 1e-6 and optical.length > 1e-6:
            log(f"stack·rear = {stack.normalized().dot((-optical).normalized()):.3f} (want ~1)")


def verify() -> None:
    for n in ("ME_RA_SPIN", "ME_DEC_SPIN", "RC14_ROOT", "IMAGING_TRAIN", "RC14_FOCUSER"):
        log(f"check {n}: {'OK' if bpy.data.objects.get(n) else 'MISSING'}")
    it = bpy.data.objects.get("IMAGING_TRAIN")
    if it:
        log(f"IT rot deg = {tuple(round(math.degrees(v), 1) for v in it.rotation_euler)}")
        log(f"IT parent = {it.parent.name if it.parent else None}")


def main() -> None:
    log(f"Opening {BLEND_PATH}")
    bpy.ops.wm.open_mainfile(filepath=BLEND_PATH)

    root = bpy.data.objects.get("RC14_ROOT")
    if not root:
        log("FATAL: RC14_ROOT missing — run initial build first")
        sys.exit(1)

    coll = bpy.data.collections.get("03_RC14")
    if coll is None:
        coll = root.users_collection[0] if root.users_collection else bpy.context.scene.collection

    # Keep root; rebuild everything else under it
    delete_rc14_meshes(keep_names={"RC14_ROOT", "RC14_FOCUSER"})
    # Also clear children parenting on focuser before rebuild
    focuser_old = bpy.data.objects.get("RC14_FOCUSER")
    it = bpy.data.objects.get("IMAGING_TRAIN")
    if it and it.parent == focuser_old:
        mw = it.matrix_world.copy()
        it.parent = None
        it.matrix_world = mw

    if focuser_old:
        bpy.data.objects.remove(focuser_old, do_unlink=True)

    focuser = build_rc14(root, coll)
    fix_imaging_train(focuser)

    # Keep IT in imaging collection
    img_coll = bpy.data.collections.get("04_ImagingTrain")
    if it and img_coll and it.name not in [o.name for o in img_coll.objects]:
        try:
            img_coll.objects.link(it)
        except RuntimeError:
            pass

    verify()
    bpy.ops.wm.save_as_mainfile(filepath=BLEND_PATH)
    log(f"Saved {BLEND_PATH}")


if __name__ == "__main__":
    main()

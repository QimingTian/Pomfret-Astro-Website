"""
Build telescope-rc14.blend from a copy of telescope.blend:
- strip grass/trees/environment
- remove C14 + FSQ-106
- add procedural RC14 truss OTA
- reattach IMAGING_TRAIN to RC rear
"""
from __future__ import annotations

import math
import sys

import bmesh
import bpy
from mathutils import Matrix, Vector

BLEND_PATH = "/Users/tianqiming/Desktop/telescope-rc14.blend"


def log(msg: str) -> None:
    print(f"[RC14] {msg}", flush=True)


def delete_objects(objs: list[bpy.types.Object]) -> None:
    for obj in objs:
        if obj is None:
            continue
        try:
            bpy.data.objects.remove(obj, do_unlink=True)
        except ReferenceError:
            pass


def purge_orphans(passes: int = 2) -> None:
    for _ in range(passes):
        try:
            bpy.ops.outliner.orphans_purge(do_local_ids=True, do_linked_ids=True, do_recursive=True)
        except Exception:
            break


def ensure_collection(name: str, parent: bpy.types.Collection) -> bpy.types.Collection:
    coll = bpy.data.collections.get(name)
    if coll is None:
        coll = bpy.data.collections.new(name)
    linked = False
    if coll.name in [c.name for c in parent.children]:
        linked = True
    if coll.name in [c.name for c in bpy.context.scene.collection.children]:
        linked = True
    for c in bpy.data.collections:
        if coll.name in [ch.name for ch in c.children]:
            linked = True
            break
    if not linked:
        parent.children.link(coll)
    return coll


def link_object(obj: bpy.types.Object, coll: bpy.types.Collection) -> None:
    for c in list(obj.users_collection):
        c.objects.unlink(obj)
    coll.objects.link(obj)


def get_mat(preferred: str, fallback_color=(0.015, 0.015, 0.017, 1.0)) -> bpy.types.Material:
    for name in (preferred, "C14Black", "AnodizedBlack", "PierBlack"):
        mat = bpy.data.materials.get(name)
        if mat is not None:
            if name == preferred:
                return mat
            copy = mat.copy()
            copy.name = preferred
            return copy
    mat = bpy.data.materials.new(preferred)
    mat.diffuse_color = fallback_color
    return mat


def assign_mat(obj: bpy.types.Object, mat: bpy.types.Material) -> None:
    if obj.data and hasattr(obj.data, "materials"):
        obj.data.materials.clear()
        obj.data.materials.append(mat)


def mesh_from_bmesh(name: str, bm: bmesh.types.BMesh) -> bpy.types.Mesh:
    mesh = bpy.data.meshes.new(name)
    bm.to_mesh(mesh)
    bm.free()
    mesh.update()
    return mesh


def new_mesh_object(
    name: str,
    mesh: bpy.types.Mesh,
    parent: bpy.types.Object,
    coll: bpy.types.Collection,
) -> bpy.types.Object:
    obj = bpy.data.objects.new(name, mesh)
    link_object(obj, coll)
    obj.parent = parent
    return obj


def make_hex_ring(name: str, outer_r: float, inner_r: float, thickness: float) -> bpy.types.Mesh:
    bm = bmesh.new()

    def hex_pts(r: float, y: float):
        return [
            (r * math.cos(math.radians(30 + i * 60)), y, r * math.sin(math.radians(30 + i * 60)))
            for i in range(6)
        ]

    y0, y1 = -thickness * 0.5, thickness * 0.5
    outer0 = [bm.verts.new(p) for p in hex_pts(outer_r, y0)]
    outer1 = [bm.verts.new(p) for p in hex_pts(outer_r, y1)]
    inner0 = [bm.verts.new(p) for p in hex_pts(inner_r, y0)]
    inner1 = [bm.verts.new(p) for p in hex_pts(inner_r, y1)]

    def bridge(a, b):
        for i in range(len(a)):
            j = (i + 1) % len(a)
            bm.faces.new([a[i], a[j], b[j], b[i]])

    bridge(outer0, outer1)
    bridge(inner1, inner0)
    for i in range(6):
        j = (i + 1) % 6
        bm.faces.new([outer0[i], outer0[j], inner0[j], inner0[i]])
        bm.faces.new([outer1[j], outer1[i], inner1[i], inner1[j]])

    # CNC lightening slots: rectangular holes through each flat (true through-holes)
    hole_w, hole_h = outer_r * 0.16, outer_r * 0.10
    for i in range(6):
        a = math.radians(30 + i * 60)
        cx = outer_r * 0.70 * math.cos(a)
        cz = outer_r * 0.70 * math.sin(a)
        ca, sa = math.cos(a), math.sin(a)
        # local slot axes: radial (ca,sa) and tangential (-sa, ca)
        corners = [(-hole_w, -hole_h), (hole_w, -hole_h), (hole_w, hole_h), (-hole_w, hole_h)]
        s0, s1 = [], []
        for u, v in corners:
            # rotate slot into XZ
            dx = u * (-sa) + v * ca * 0  # tangential * u
            # u along tangential, v along radial in plane
            tx, tz = -sa, ca
            rx, rz = ca, sa
            x = cx + u * tx + v * rx
            z = cz + u * tz + v * rz
            s0.append(bm.verts.new((x, y0, z)))
            s1.append(bm.verts.new((x, y1, z)))
        bridge(s1, s0)

    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return mesh_from_bmesh(name, bm)


def make_cylinder_y(name: str, radius: float, depth: float, segments: int = 48) -> bpy.types.Mesh:
    bm = bmesh.new()
    bmesh.ops.create_cone(
        bm,
        cap_ends=True,
        cap_tris=False,
        segments=segments,
        radius1=radius,
        radius2=radius,
        depth=depth,
    )
    bmesh.ops.rotate(bm, verts=bm.verts, cent=(0, 0, 0), matrix=Matrix.Rotation(math.radians(90), 3, "X"))
    return mesh_from_bmesh(name, bm)


def make_tube_y(name: str, outer_r: float, inner_r: float, depth: float, segments: int = 48) -> bpy.types.Mesh:
    bm = bmesh.new()
    y0, y1 = -depth * 0.5, depth * 0.5

    def ring(r, y):
        return [
            bm.verts.new(
                (
                    r * math.cos(2 * math.pi * i / segments),
                    y,
                    r * math.sin(2 * math.pi * i / segments),
                )
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
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return mesh_from_bmesh(name, bm)


def make_box(name: str, size: Vector) -> bpy.types.Mesh:
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    bmesh.ops.scale(bm, verts=bm.verts, vec=size)
    return mesh_from_bmesh(name, bm)


def make_dovetail(name: str, length: float, width: float, height: float) -> bpy.types.Mesh:
    bm = bmesh.new()
    w = width * 0.5
    top_w = width * 0.38
    y0, y1 = -length * 0.5, length * 0.5
    profile = [(-w, 0.0), (w, 0.0), (top_w, height), (-top_w, height)]
    v0 = [bm.verts.new((x, y0, z)) for x, z in profile]
    v1 = [bm.verts.new((x, y1, z)) for x, z in profile]
    bm.faces.new(v0)
    bm.faces.new(list(reversed(v1)))
    for i in range(4):
        j = (i + 1) % 4
        bm.faces.new([v0[i], v0[j], v1[j], v1[i]])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return mesh_from_bmesh(name, bm)


def strip_environment() -> None:
    log("Stripping environment / grass / trees...")
    names = ["06_Environment", "GrassBlades", "GrassInstances"]
    to_delete: list[bpy.types.Object] = []
    for cname in names:
        coll = bpy.data.collections.get(cname)
        if not coll:
            continue
        stack = [coll]
        while stack:
            c = stack.pop()
            stack.extend(list(c.children))
            to_delete.extend(list(c.objects))

    for obj in list(bpy.data.objects):
        n = obj.name
        if n.startswith(("Grass", "Tree", "TreeFar", "Lawn")):
            to_delete.append(obj)

    seen: set[str] = set()
    uniq: list[bpy.types.Object] = []
    for o in to_delete:
        if o.name not in seen:
            seen.add(o.name)
            uniq.append(o)

    log(f"Deleting {len(uniq)} environment objects...")
    delete_objects(uniq)

    for cname in names:
        coll = bpy.data.collections.get(cname)
        if not coll:
            continue
        for parent in list(bpy.data.collections):
            if coll.name in [c.name for c in parent.children]:
                parent.children.unlink(coll)
        if coll.name in [c.name for c in bpy.context.scene.collection.children]:
            bpy.context.scene.collection.children.unlink(coll)
        bpy.data.collections.remove(coll)

    purge_orphans()
    log(f"Objects remaining: {len(bpy.data.objects)}")


def detach_imaging_train() -> bpy.types.Object | None:
    it = bpy.data.objects.get("IMAGING_TRAIN")
    if not it:
        log("WARNING: IMAGING_TRAIN not found")
        return None
    mw = it.matrix_world.copy()
    it.parent = None
    it.matrix_world = mw
    log(f"Detached IMAGING_TRAIN; world loc={tuple(round(v, 4) for v in mw.translation)}")
    return it


def delete_hierarchy(root_name: str) -> None:
    root = bpy.data.objects.get(root_name)
    if not root:
        log(f"{root_name} already gone")
        return
    objs = [root]
    i = 0
    while i < len(objs):
        objs.extend(list(objs[i].children))
        i += 1
    log(f"Deleting hierarchy {root_name}: {len(objs)} objects")
    delete_objects(objs)


def remove_otas() -> bpy.types.Object | None:
    log("Removing C14 / FSQ / piggy; preserving IMAGING_TRAIN...")
    it = detach_imaging_train()
    delete_hierarchy("FSQ106_ROOT")
    delete_hierarchy("C14_ROOT")
    for cname in ("03_FSQ106", "03b_C14"):
        coll = bpy.data.collections.get(cname)
        if not coll:
            continue
        for parent in list(bpy.data.collections):
            if coll.name in [c.name for c in parent.children]:
                parent.children.unlink(coll)
        if coll.name in [c.name for c in bpy.context.scene.collection.children]:
            bpy.context.scene.collection.children.unlink(coll)
        try:
            bpy.data.collections.remove(coll)
        except Exception:
            pass
    purge_orphans()
    return it


def build_rc14(versa: bpy.types.Object, coll: bpy.types.Collection) -> tuple[bpy.types.Object, bpy.types.Object]:
    log("Building RC14 truss OTA...")
    mat_black = get_mat("RC14_Black")
    mat_carbon = get_mat("RC14_Carbon")
    mat_metal = get_mat("RC14_Metal")

    aperture = 0.355
    rear_outer = 0.260
    front_outer = 0.225
    rear_inner = 0.185
    front_inner = 0.175
    secondary_r = 0.085
    primary_cell_depth = 0.12

    y_rear_cell = -0.42
    y_rear_ring = -0.30
    y_mid_ring = 0.05
    y_front_ring = 0.48
    y_secondary = 0.50

    root = bpy.data.objects.new("RC14_ROOT", None)
    root.empty_display_type = "PLAIN_AXES"
    root.empty_display_size = 0.15
    link_object(root, coll)
    root.parent = versa
    root.location = (0.0, -0.2271, 0.0006)
    root.rotation_euler = (math.radians(89.98), 0.0, 0.0)
    root.scale = (1, 1, 1)

    rear_cell = new_mesh_object(
        "RC14_RearCell",
        make_tube_y("RC14_RearCell", rear_outer * 0.92, aperture * 0.5 * 0.55, primary_cell_depth, 64),
        root,
        coll,
    )
    rear_cell.location = (0, y_rear_cell, 0)
    assign_mat(rear_cell, mat_black)

    baffle = new_mesh_object(
        "RC14_PrimaryBaffle",
        make_tube_y("RC14_PrimaryBaffle", aperture * 0.22, aperture * 0.16, 0.22, 32),
        root,
        coll,
    )
    baffle.location = (0, y_rear_cell + 0.12, 0)
    assign_mat(baffle, mat_black)

    collar = new_mesh_object(
        "RC14_FocuserCollar",
        make_tube_y("RC14_FocuserCollar", 0.065, 0.048, 0.035, 48),
        root,
        coll,
    )
    collar.location = (0, y_rear_cell - primary_cell_depth * 0.5 - 0.02, 0)
    assign_mat(collar, mat_metal)

    focuser = bpy.data.objects.new("RC14_FOCUSER", None)
    focuser.empty_display_type = "CIRCLE"
    focuser.empty_display_size = 0.05
    link_object(focuser, coll)
    focuser.parent = root
    focuser.location = (0, collar.location.y - 0.04, 0)

    for i, ang in enumerate((0, 120, 240)):
        fan = new_mesh_object(
            f"RC14_Fan_{i}",
            make_cylinder_y(f"RC14_Fan_{i}", 0.018, 0.012, 16),
            root,
            coll,
        )
        a = math.radians(ang)
        r = 0.12
        fan.location = (r * math.cos(a), y_rear_cell - primary_cell_depth * 0.5 - 0.005, r * math.sin(a))
        assign_mat(fan, mat_metal)

    def add_ring(name: str, outer: float, inner: float, thick: float, y: float):
        obj = new_mesh_object(name, make_hex_ring(name, outer, inner, thick), root, coll)
        obj.location = (0, y, 0)
        assign_mat(obj, mat_black)
        return obj

    add_ring("RC14_RearRing", rear_outer, rear_inner, 0.012, y_rear_ring)
    add_ring("RC14_MidRing", rear_outer, rear_inner * 1.05, 0.012, y_mid_ring)
    add_ring("RC14_FrontRing", front_outer, front_inner, 0.008, y_front_ring)
    add_ring("RC14_FrontRing2", front_outer, front_inner, 0.006, y_front_ring + 0.035)

    idx = 0

    def add_truss(y_a, y_b, r_a, r_b, ang_a, ang_b):
        nonlocal idx
        p0 = Vector((r_a * math.cos(ang_a), y_a, r_a * math.sin(ang_a)))
        p1 = Vector((r_b * math.cos(ang_b), y_b, r_b * math.sin(ang_b)))
        mid = (p0 + p1) * 0.5
        direction = p1 - p0
        length = direction.length
        tube = new_mesh_object(
            f"RC14_Truss_{idx}",
            make_cylinder_y(f"RC14_Truss_{idx}", 0.008, length, 10),
            root,
            coll,
        )
        idx += 1
        tube.location = mid
        tube.rotation_mode = "QUATERNION"
        tube.rotation_quaternion = Vector((0, 1, 0)).rotation_difference(direction.normalized())
        assign_mat(tube, mat_carbon)

    for i in range(6):
        a0 = math.radians(30 + i * 60)
        a1 = math.radians(30 + ((i + 1) % 6) * 60)
        add_truss(y_rear_ring, y_mid_ring, rear_outer * 0.92, rear_outer * 0.92, a0, a1)
        add_truss(y_rear_ring, y_mid_ring, rear_outer * 0.92, rear_outer * 0.92, a1, a0)
        add_truss(y_mid_ring, y_front_ring, rear_outer * 0.92, front_outer * 0.92, a0, a1)
        add_truss(y_mid_ring, y_front_ring, rear_outer * 0.92, front_outer * 0.92, a1, a0)

    sec = new_mesh_object(
        "RC14_Secondary",
        make_tube_y("RC14_Secondary", secondary_r, secondary_r * 0.55, 0.07, 48),
        root,
        coll,
    )
    sec.location = (0, y_secondary, 0)
    assign_mat(sec, mat_black)

    sec_cap = new_mesh_object(
        "RC14_SecondaryCap",
        make_cylinder_y("RC14_SecondaryCap", secondary_r * 0.95, 0.01, 32),
        root,
        coll,
    )
    sec_cap.location = (0, y_secondary + 0.04, 0)
    assign_mat(sec_cap, mat_black)

    for i in range(4):
        ang = math.radians(i * 90)
        span = front_inner - secondary_r * 0.9
        vane = new_mesh_object(
            f"RC14_Spider_{i}",
            make_box(f"RC14_Spider_{i}", Vector((0.002, 0.01, span))),
            root,
            coll,
        )
        r_mid = (secondary_r + front_inner) * 0.5
        vane.location = (r_mid * math.cos(ang), y_front_ring + 0.01, r_mid * math.sin(ang))
        vane.rotation_euler = (0, -ang + math.radians(90), 0)
        assign_mat(vane, mat_metal)

    dovetail = new_mesh_object(
        "RC14_Dovetail",
        make_dovetail("RC14_Dovetail", length=0.40, width=0.078, height=0.018),
        root,
        coll,
    )
    dovetail.location = (0.0, 0.0, -0.208)
    dovetail.rotation_euler = (math.radians(180), 0, 0)
    assign_mat(dovetail, mat_metal)

    top_rail = new_mesh_object(
        "RC14_TopRail",
        make_dovetail("RC14_TopRail", length=0.36, width=0.070, height=0.016),
        root,
        coll,
    )
    top_rail.location = (0.0, 0.05, 0.210)
    assign_mat(top_rail, mat_metal)

    log("RC14 geometry created")
    return root, focuser


def attach_imaging_train(it: bpy.types.Object | None, focuser: bpy.types.Object) -> None:
    if it is None:
        log("No IMAGING_TRAIN to attach")
        return
    log("Attaching IMAGING_TRAIN to RC14_FOCUSER...")
    it.parent = focuser
    it.matrix_parent_inverse.identity()
    # FSQ106_ROOT had local rot (-90 X); imaging train parts were authored in that frame.
    # RC14_FOCUSER matches C14_ROOT / optical +Y frame, so compensate with -90 X.
    it.location = (0.0, -0.02, 0.0)
    it.rotation_euler = (math.radians(-90.0), 0.0, 0.0)
    it.scale = (1, 1, 1)
    log(f"IMAGING_TRAIN parent={it.parent.name} loc={tuple(it.location)} rotX=-90")


def verify() -> None:
    for n in ("ME_RA_SPIN", "ME_DEC_SPIN", "ME_VersaPlate", "RC14_ROOT", "IMAGING_TRAIN", "PIER_ROOT", "PARAMOUNT_ME"):
        log(f"check {n}: {'OK' if bpy.data.objects.get(n) else 'MISSING'}")
    bad = [
        o.name
        for o in bpy.data.objects
        if o.name.startswith(("Grass", "Tree", "C14_", "FSQ_")) or o.name in ("C14_ROOT", "FSQ106_ROOT")
    ]
    if bad:
        log(f"WARNING leftover: {bad[:30]}")
    else:
        log("No leftover grass/tree/C14/FSQ objects")
    log(f"Total objects: {len(bpy.data.objects)}")


def main() -> None:
    log(f"Opening {BLEND_PATH}")
    bpy.ops.wm.open_mainfile(filepath=BLEND_PATH)

    strip_environment()
    it = remove_otas()

    versa = bpy.data.objects.get("ME_VersaPlate")
    if not versa:
        log("FATAL: ME_VersaPlate missing")
        sys.exit(1)

    parent_coll = bpy.data.collections.get("AstroSetup") or bpy.context.scene.collection
    rc_coll = ensure_collection("03_RC14", parent_coll)
    img_coll = bpy.data.collections.get("04_ImagingTrain")

    _root, focuser = build_rc14(versa, rc_coll)
    attach_imaging_train(it, focuser)

    if it and img_coll:
        stack = [it]
        for obj in stack:
            stack.extend(list(obj.children))
            if obj.name not in [o.name for o in img_coll.objects]:
                try:
                    img_coll.objects.link(obj)
                except RuntimeError:
                    pass

    verify()
    bpy.ops.wm.save_as_mainfile(filepath=BLEND_PATH)
    log(f"Saved {BLEND_PATH}")


if __name__ == "__main__":
    main()

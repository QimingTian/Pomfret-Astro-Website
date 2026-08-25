#!/usr/bin/env python3
"""Build NINA sequence JSON from frozen templates + a signed Pomfret job envelope."""

from __future__ import annotations

import copy
import hashlib
import hmac
import json
import os
import sys
from pathlib import Path
from typing import Any, Optional

TYPE_KEY = "$type"
ID_KEY = "$id"
REF_KEY = "$ref"

JOB_KIND = "pomfret-nina-job"
JOB_VERSION = 7

_TEMPLATES = Path(__file__).resolve().parent / "nina_templates"


def _load_template(name: str) -> dict[str, Any]:
    path = _TEMPLATES / name
    with path.open(encoding="utf-8") as f:
        data = json.load(f)
    if not isinstance(data, dict):
        raise ValueError(f"Template {name} is not an object")
    return data


def _as_record(value: Any) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise ValueError("Expected object")
    return value


def _as_array(value: Any) -> list[Any]:
    if not isinstance(value, list):
        raise ValueError("Expected array")
    return value


def _has_type(node: Any, prefix: str) -> bool:
    if not isinstance(node, dict):
        return False
    t = node.get(TYPE_KEY)
    return isinstance(t, str) and t.startswith(prefix)


def _find_first_by_type(node: Any, prefix: str) -> Optional[dict[str, Any]]:
    if isinstance(node, list):
        for item in node:
            hit = _find_first_by_type(item, prefix)
            if hit is not None:
                return hit
        return None
    if not isinstance(node, dict):
        return None
    if _has_type(node, prefix):
        return node
    for child in node.values():
        hit = _find_first_by_type(child, prefix)
        if hit is not None:
            return hit
    return None


def _find_last_by_type(node: Any, prefix: str) -> Optional[dict[str, Any]]:
    if isinstance(node, list):
        for item in reversed(node):
            hit = _find_last_by_type(item, prefix)
            if hit is not None:
                return hit
        return None
    if not isinstance(node, dict):
        return None
    for child in reversed(list(node.values())):
        hit = _find_last_by_type(child, prefix)
        if hit is not None:
            return hit
    return node if _has_type(node, prefix) else None


def _find_target_container(node: Any) -> Optional[dict[str, Any]]:
    for prefix in (
        "NINA.Sequencer.Container.DeepSkyObjectContainer",
        "NINA.Plugin.ExoPlanets.Sequencer.Container.ExoPlanetObjectContainer",
        "NINA.Plugin.ExoPlanets.Sequencer.Container.VariableStarObjectContainer",
    ):
        hit = _find_first_by_type(node, prefix)
        if hit is not None:
            return hit
    return None


def _resolve_target(dso: dict[str, Any]) -> dict[str, Any]:
    base = _as_record(dso.get("Target"))
    if base.get("InputCoordinates") is not None:
        return base
    ref_id = base.get(REF_KEY)
    if not isinstance(ref_id, str):
        raise ValueError("Template: Target has no InputCoordinates and no $ref")
    for value in dso.values():
        if isinstance(value, dict) and value.get(ID_KEY) == ref_id and value.get("InputCoordinates") is not None:
            return value
    raise ValueError(f'Template: could not resolve Target $ref "{ref_id}"')


def _collect_numeric_ids(node: Any, out: list[int]) -> None:
    if isinstance(node, list):
        for item in node:
            _collect_numeric_ids(item, out)
        return
    if not isinstance(node, dict):
        return
    raw = node.get(ID_KEY)
    if isinstance(raw, str) and raw.isdigit():
        out.append(int(raw))
    for child in node.values():
        _collect_numeric_ids(child, out)


def _next_id(root: dict[str, Any], used: set[int]) -> str:
    if not used:
        all_ids: list[int] = []
        _collect_numeric_ids(root, all_ids)
        used.update(all_ids)
    nxt = (max(used) if used else 0) + 1
    used.add(nxt)
    return str(nxt)


def _build_filter_info(root: dict[str, Any], used: set[int], filter_name: str) -> dict[str, Any]:
    return {
        ID_KEY: _next_id(root, used),
        TYPE_KEY: "NINA.Core.Model.Equipment.FilterInfo, NINA.Core",
        "_name": filter_name,
        "_focusOffset": 0,
        "_position": 0,
        "_autoFocusExposureTime": -1.0,
        "_autoFocusFilter": False,
        "FlatWizardFilterSettings": {
            ID_KEY: _next_id(root, used),
            TYPE_KEY: "NINA.Core.Model.Equipment.FlatWizardFilterSettings, NINA.Core",
            "FlatWizardMode": 0,
            "HistogramMeanTarget": 0.5,
        },
    }


def _remap_ids_in_clone(root: dict[str, Any], used: set[int], node: Any) -> Any:
    cloned = copy.deepcopy(node)
    id_map: dict[str, str] = {}

    def collect(value: Any) -> None:
        if isinstance(value, list):
            for item in value:
                collect(item)
            return
        if not isinstance(value, dict):
            return
        raw = value.get(ID_KEY)
        if isinstance(raw, str) and raw not in id_map:
            id_map[raw] = _next_id(root, used)
        for child in value.values():
            collect(child)

    def rewrite(value: Any) -> None:
        if isinstance(value, list):
            for item in value:
                rewrite(item)
            return
        if not isinstance(value, dict):
            return
        raw = value.get(ID_KEY)
        if isinstance(raw, str) and raw in id_map:
            value[ID_KEY] = id_map[raw]
        raw_ref = value.get(REF_KEY)
        if isinstance(raw_ref, str) and raw_ref in id_map:
            value[REF_KEY] = id_map[raw_ref]
        for child in value.values():
            rewrite(child)

    collect(cloned)
    rewrite(cloned)
    return cloned


def _index_by_type(values: list[Any], prefix: str) -> int:
    for i, item in enumerate(values):
        if _has_type(item, prefix):
            return i
    return -1


def _index_http_post_body(values: list[Any], post_body: str) -> int:
    for i, item in enumerate(values):
        if not isinstance(item, dict):
            continue
        if not _has_type(item, "DaleGhent.NINA.GroundStation.HTTP.HttpClient"):
            continue
        if item.get("HttpPostBody") == post_body:
            return i
    return -1


def _round_seconds(x: float) -> float:
    return round(x * 1e6) / 1e6


def ra_decimal_to_nina(ra_hours: float) -> dict[str, Any]:
    h = ra_hours % 24
    if h < 0:
        h += 24
    total = h * 3600
    hours = int(total // 3600)
    total -= hours * 3600
    minutes = int(total // 60)
    seconds = _round_seconds(total - minutes * 60)
    return {"RAHours": hours, "RAMinutes": minutes, "RASeconds": seconds}


def dec_decimal_to_nina(dec_deg: float) -> dict[str, Any]:
    negative = dec_deg < 0
    absv = abs(dec_deg)
    degrees = int(absv)
    absv = (absv - degrees) * 60
    minutes = int(absv)
    seconds = _round_seconds((absv - minutes) * 60)
    return {
        "NegativeDec": negative,
        "DecDegrees": degrees,
        "DecMinutes": minutes,
        "DecSeconds": seconds,
    }


def _assert_json_refs_clean(node: Any, path: str = "$") -> None:
    if isinstance(node, list):
        for i, item in enumerate(node):
            _assert_json_refs_clean(item, f"{path}[{i}]")
        return
    if not isinstance(node, dict):
        return
    if REF_KEY in node and any(k != REF_KEY for k in node):
        raise ValueError(f"NINA $ref object has extra keys at {path}: {sorted(node)}")
    for key, child in node.items():
        _assert_json_refs_clean(child, f"{path}.{key}")


def _apply_nina_coords(coords: dict[str, Any], ra_hours: float, dec_deg: float) -> None:
    if REF_KEY in coords:
        raise ValueError("Refusing to write coordinates onto a $ref object")
    coords.update(ra_decimal_to_nina(ra_hours))
    coords.update(dec_decimal_to_nina(dec_deg))


def _apply_exo_coords(coords: dict[str, Any], ra_hours: float, dec_deg: float) -> None:
    if REF_KEY in coords:
        raise ValueError("Refusing to write ExoPlanet coordinates onto a $ref object")
    ra = ra_decimal_to_nina(ra_hours)
    dec = dec_decimal_to_nina(dec_deg)
    ra_h = ra["RAHours"] + ra["RAMinutes"] / 60 + ra["RASeconds"] / 3600
    dec_abs = dec["DecDegrees"] + dec["DecMinutes"] / 60 + dec["DecSeconds"] / 3600
    dec_signed = -dec_abs if dec["NegativeDec"] else dec_abs
    sign = "-" if dec["NegativeDec"] else "+"
    pad2 = lambda n: str(int(abs(n))).zfill(2)
    ra_sec = f"{ra['RASeconds']:.3f}".rjust(6, "0")
    dec_sec = f"{dec['DecSeconds']:.2f}".rjust(5, "0")
    coords["RA"] = ra_h
    coords["RADegrees"] = ra_h * 15
    coords["Dec"] = dec_signed
    coords["RAString"] = f"{pad2(ra['RAHours'])}:{pad2(ra['RAMinutes'])}:{ra_sec}"
    coords["DecString"] = f"{sign}{pad2(dec['DecDegrees'])}° {pad2(dec['DecMinutes'])}' {dec_sec}\""


def _apply_variable_star_window(dso: dict[str, Any], window: dict[str, Any]) -> None:
    end = window.get("end") or {}
    cond = _find_last_by_type(dso, "NINA.Sequencer.Conditions.TimeCondition")
    if cond is None:
        cond = _find_last_by_type(dso, "NINA.Plugin.ExoPlanets.Sequencer.Conditions.TransitCondition")
    if cond is not None:
        cond["Hours"] = end.get("hours", 0)
        cond["Minutes"] = end.get("minutes", 0)
        cond["Seconds"] = end.get("seconds", 0)
        cond["MinutesOffset"] = 0


def _apply_cooling(node: Any, temp_c: float) -> None:
    if isinstance(node, list):
        for item in node:
            _apply_cooling(item, temp_c)
        return
    if not isinstance(node, dict):
        return
    t = node.get(TYPE_KEY)
    if isinstance(t, str) and "CoolCamera" in t and "Temperature" in node:
        node["Temperature"] = float(temp_c)
    for child in node.values():
        _apply_cooling(child, temp_c)


def _apply_session_progress_queue_id(node: Any, queue_id: str) -> None:
    if isinstance(node, list):
        for item in node:
            _apply_session_progress_queue_id(item, queue_id)
        return
    if not isinstance(node, dict):
        return
    t = node.get(TYPE_KEY)
    if isinstance(t, str) and "GroundStation.HTTP.HttpClient" in t:
        uri = node.get("HttpUri")
        if isinstance(uri, str) and "/api/imaging/session-progress" in uri:
            raw = node.get("HttpPostBody")
            text = (raw.replace("\r\n", "\n").strip() if isinstance(raw, str) else "")
            node["HttpPostContentType"] = "application/json"
            node["HttpPostBody"] = json.dumps({"queueId": queue_id, "text": text}, separators=(",", ":"))
    for child in node.values():
        _apply_session_progress_queue_id(child, queue_id)


def _apply_http_auth(node: Any, username: str, password: str) -> None:
    if isinstance(node, list):
        for item in node:
            _apply_http_auth(item, username, password)
        return
    if not isinstance(node, dict):
        return
    for user_key in ("HttpAuthUsername", "HttpAuthUsername"):
        if user_key in node:
            node[user_key] = username
    for pass_key in ("HttpAuthPassword", "HttpAuthPassword"):
        if pass_key in node:
            node[pass_key] = password
    for child in node.values():
        _apply_http_auth(child, username, password)


def _patch_discord_text(node: Any, text: str) -> None:
    if isinstance(node, list):
        for item in node:
            _patch_discord_text(item, text)
        return
    if not isinstance(node, dict):
        return
    t = node.get(TYPE_KEY)
    if isinstance(t, str) and "DiscordMessageInstruction" in t:
        node["Text"] = text
    for child in node.values():
        _patch_discord_text(child, text)


def _walk_http_clients(node: Any, fn) -> None:
    if isinstance(node, list):
        for item in node:
            _walk_http_clients(item, fn)
        return
    if not isinstance(node, dict):
        return
    t = node.get(TYPE_KEY)
    if isinstance(t, str) and "HTTP.HttpClient" in t:
        fn(node)
    for child in node.values():
        _walk_http_clients(child, fn)


def build_run_sequence(params: dict[str, Any]) -> dict[str, Any]:
    plans = params.get("filterPlans")
    if not isinstance(plans, list) or not plans:
        plans = [
            {
                "filterName": params["filterName"],
                "exposureSeconds": params["exposureSeconds"],
                "exposureCount": params["exposureCount"],
            }
        ]
    kind = params.get("templateKind") if params.get("templateKind") == "variable_star" else "dso"
    if kind == "variable_star":
        root = _load_template("Variable Star Sequence.json")
    elif len(plans) > 1:
        root = _load_template("Classic DSO Imaging Sequence Multi Filter.json")
    else:
        root = _load_template("Classic DSO Imaging Sequence.json")
    used: set[int] = set()
    target_area = _find_first_by_type(root, "NINA.Sequencer.Container.TargetAreaContainer")
    if target_area is None:
        raise ValueError("Template: TargetAreaContainer not found")
    dso = _find_target_container(target_area)
    if dso is None:
        raise ValueError("Template: target instruction container not found")
    target = _resolve_target(dso)
    name = params.get("targetName")
    if isinstance(name, str) and name.strip():
        target["TargetName"] = name.strip()
    input_coords = _as_record(target.get("InputCoordinates"))
    if not _has_type(input_coords, "NINA.Astrometry.InputCoordinates"):
        raise ValueError("Template: target InputCoordinates not found")
    ra = float(params["raHoursDecimal"])
    dec = float(params["decDegDecimal"])
    _apply_nina_coords(input_coords, ra, dec)
    center = _find_first_by_type(dso, "NINA.Sequencer.SequenceItem.Platesolving.Center")
    if center is not None:
        center_coords = _as_record(center.get("Coordinates"))
        if not _has_type(center_coords, "NINA.Astrometry.InputCoordinates"):
            raise ValueError("Template: Center coordinates not found")
        _apply_nina_coords(center_coords, ra, dec)
    exo = dso.get("ExoPlanetDSO")
    if isinstance(exo, dict):
        exo_coords = exo.get("Coordinates")
        if isinstance(exo_coords, dict) and REF_KEY not in exo_coords:
            _apply_exo_coords(exo_coords, ra, dec)

    dso_items = _as_record(dso.get("Items"))
    values = _as_array(dso_items.get("$values"))

    if kind == "variable_star":
        window = params.get("variableStarWindow")
        if isinstance(window, dict):
            _apply_variable_star_window(dso, window)
        switch = _find_first_by_type(values, "NINA.Sequencer.SequenceItem.FilterWheel.SwitchFilter")
        if switch is None:
            raise ValueError("Template: SwitchFilter not found")
        filter_info = switch.get("Filter")
        if not isinstance(filter_info, dict) or str(filter_info.get("_name") or "") != "G":
            raise ValueError("Template: variable star SwitchFilter must stay G")
    elif len(plans) == 1:
        switch_i = _index_by_type(values, "NINA.Sequencer.SequenceItem.FilterWheel.SwitchFilter")
        take_i = _index_by_type(values, "NINA.Sequencer.SequenceItem.Imaging.TakeManyExposures")
        if switch_i < 0 or take_i < 0:
            raise ValueError("Template: SwitchFilter or TakeManyExposures not found")
        _as_record(values[switch_i])["Filter"] = _build_filter_info(root, used, plans[0]["filterName"])
        take_many = _as_record(values[take_i])
        cond_values = _as_array(_as_record(take_many.get("Conditions")).get("$values"))
        loop = next((v for v in cond_values if _has_type(v, "NINA.Sequencer.Conditions.LoopCondition")), None)
        if not isinstance(loop, dict):
            raise ValueError("Template: LoopCondition not found")
        loop["Iterations"] = plans[0]["exposureCount"]
        loop["CompletedIterations"] = 0
        take_exp = _find_first_by_type(take_many, "NINA.Sequencer.SequenceItem.Imaging.TakeExposure")
        if take_exp is None:
            raise ValueError("Template: TakeExposure not found")
        take_exp["ExposureTime"] = float(plans[0]["exposureSeconds"])
    else:
        centered = _index_http_post_body(values, "Target Centered")
        first_switch = _index_by_type(values, "NINA.Sequencer.SequenceItem.FilterWheel.SwitchFilter")
        first_take = _index_by_type(values, "NINA.Sequencer.SequenceItem.Imaging.TakeManyExposures")
        stop_g = _index_by_type(values, "NINA.Sequencer.SequenceItem.Guider.StopGuiding")
        if min(centered, first_switch, first_take, stop_g) < 0:
            raise ValueError("Template: multi-filter anchors missing")
        second_rel = _index_by_type(values[stop_g + 1 :], "NINA.Sequencer.SequenceItem.Imaging.TakeManyExposures")
        if second_rel < 0:
            raise ValueError("Template: second TakeManyExposures not found")
        second_abs = stop_g + 1 + second_rel
        prefix = values[: centered + 1]
        first_block = values[first_switch : first_take + 1]
        repeat_block = values[stop_g : second_abs + 1]
        suffix = values[second_abs + 1 :]
        rebuilt: list[Any] = list(prefix)
        for i, plan in enumerate(plans):
            segment = copy.deepcopy(first_block if i == 0 else repeat_block)
            segment = _remap_ids_in_clone(root, used, segment)
            seg_switch = next((v for v in segment if _has_type(v, "NINA.Sequencer.SequenceItem.FilterWheel.SwitchFilter")), None)
            seg_take = next((v for v in segment if _has_type(v, "NINA.Sequencer.SequenceItem.Imaging.TakeManyExposures")), None)
            if not isinstance(seg_switch, dict) or not isinstance(seg_take, dict):
                raise ValueError("Template: cloned segment missing filter/exposure")
            seg_switch["Filter"] = _build_filter_info(root, used, plan["filterName"])
            cond_values = _as_array(_as_record(seg_take.get("Conditions")).get("$values"))
            loop = next((v for v in cond_values if _has_type(v, "NINA.Sequencer.Conditions.LoopCondition")), None)
            if not isinstance(loop, dict):
                raise ValueError("Template: LoopCondition not found")
            loop["Iterations"] = plan["exposureCount"]
            loop["CompletedIterations"] = 0
            take_exp = _find_first_by_type(seg_take, "NINA.Sequencer.SequenceItem.Imaging.TakeExposure")
            if take_exp is None:
                raise ValueError("Template: TakeExposure not found")
            take_exp["ExposureTime"] = float(plan["exposureSeconds"])
            rebuilt.extend(segment)
        rebuilt.extend(suffix)
        dso_items["$values"] = rebuilt

    queue_id = str(params.get("pomfretQueueId") or "").strip()
    if queue_id:
        root["PomfretAstro"] = {
            "QueueId": queue_id,
            "OutputMode": params.get("outputMode") or "raw_zip",
            "FilterName": "G" if kind == "variable_star" else plans[0]["filterName"],
            "FilterPlans": plans,
            "SessionProgressHint": 'POST JSON to /api/imaging/session-progress with { "queueId": "<QueueId>", ... }',
        }
        _apply_session_progress_queue_id(root, queue_id)
    if params.get("cameraCoolingTempC") is not None:
        _apply_cooling(root, float(params["cameraCoolingTempC"]))
    _assert_json_refs_clean(root)
    return root


def build_estop_sequence(queue_id: str, discord_text: str) -> dict[str, Any]:
    root = _load_template("EStop.json")
    root["Name"] = "Emergency Stop"
    root["PomfretAstro"] = {
        "QueueId": queue_id,
        "SessionType": "estop",
        "OutputMode": "none",
        "SessionProgressHint": "POST to /api/imaging/session-progress with queueId when dome is closed to clear ESTOP.",
    }
    body = json.dumps(
        {"text": "Dome Closed", "queueId": queue_id, "PomfretAstro": {"QueueId": queue_id, "SessionType": "estop"}},
        separators=(",", ":"),
    )

    def patch(client: dict[str, Any]) -> None:
        client["HttpPostBody"] = body
        client["HttpPostContentType"] = "application/json"

    _walk_http_clients(root, patch)
    _patch_discord_text(root, discord_text)
    return root


def build_end_night_sequence(queue_id: str, trigger: str, discord_text: str) -> dict[str, Any]:
    root = _load_template("End Night Session.json")
    root["PomfretAstro"] = {
        "QueueId": queue_id,
        "SessionType": "end_night",
        "EndNightTrigger": trigger,
        "SessionProgressHint": 'POST JSON to /api/imaging/session-progress with { "queueId": "<QueueId>", ... }',
    }
    _patch_discord_text(root, discord_text)
    return root


def stable_stringify(value: Any) -> str:
    if value is None:
        return "null"
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        if isinstance(value, float) and not (value == value and abs(value) != float("inf")):
            raise ValueError("non-finite number")
        return json.dumps(value)
    if isinstance(value, str):
        return json.dumps(value, ensure_ascii=False)
    if isinstance(value, list):
        return "[" + ",".join(stable_stringify(v) for v in value) + "]"
    if isinstance(value, dict):
        keys = sorted(value.keys())
        inner = ",".join(json.dumps(k, ensure_ascii=False) + ":" + stable_stringify(value[k]) for k in keys)
        return "{" + inner + "}"
    raise ValueError(f"cannot stringify {type(value)}")


def parse_job_envelope(payload: Any) -> Optional[dict[str, Any]]:
    if not isinstance(payload, dict):
        return None
    job = payload.get("PomfretAstroJob")
    if not isinstance(job, dict):
        return None
    if job.get("kind") != JOB_KIND:
        return None
    return job


def verify_job_signature(job: dict[str, Any], secret: str) -> bool:
    if not secret:
        return True
    sig = job.get("signature")
    unsigned = {k: v for k, v in job.items() if k != "signature"}
    expected = hmac.new(secret.encode("utf-8"), stable_stringify(unsigned).encode("utf-8"), hashlib.sha256).hexdigest()
    return isinstance(sig, str) and hmac.compare_digest(sig, expected)


def materialize_job(job: dict[str, Any]) -> dict[str, Any]:
    command = job.get("command")
    queue_id = str(job.get("queueId") or "")
    if command == "run":
        params = job.get("params")
        if not isinstance(params, dict):
            raise ValueError("run job missing params")
        root = build_run_sequence(params)
    elif command == "estop":
        estop = job.get("estop") if isinstance(job.get("estop"), dict) else {}
        root = build_estop_sequence(queue_id, str(estop.get("discordText") or "ESTOPPED"))
    elif command == "end_night":
        end = job.get("endNight") if isinstance(job.get("endNight"), dict) else {}
        root = build_end_night_sequence(
            queue_id,
            str(end.get("trigger") or "after_sessions"),
            str(end.get("discordText") or "Tonight's Session Completed."),
        )
    else:
        raise ValueError(f"unknown job command: {command}")
    auth = job.get("httpAuth")
    if isinstance(auth, dict) and auth.get("password"):
        _apply_http_auth(root, str(auth.get("username") or "pomfretastro"), str(auth["password"]))
    return root


def materialize_poll_payload(content: bytes, secret: Optional[str] = None) -> bytes:
    try:
        payload = json.loads(content.decode("utf-8"))
    except Exception:
        return content
    job = parse_job_envelope(payload)
    if job is None:
        return content
    sec = secret if secret is not None else os.environ.get("IMAGING_QUEUE_SECRET", "").strip()
    if sec and not verify_job_signature(job, sec):
        raise ValueError("Nina job signature mismatch")
    sequence = materialize_job(job)
    return json.dumps(sequence, indent=2, ensure_ascii=False).encode("utf-8")


def is_estop_job_or_sequence(content: bytes) -> bool:
    try:
        payload = json.loads(content.decode("utf-8"))
    except Exception:
        return False
    if not isinstance(payload, dict):
        return False
    job = parse_job_envelope(payload)
    if job is not None:
        return job.get("command") == "estop"
    pomfret = payload.get("PomfretAstro")
    return isinstance(pomfret, dict) and pomfret.get("SessionType") == "estop"


def job_fingerprint(content: bytes) -> Optional[str]:
    try:
        payload = json.loads(content.decode("utf-8"))
    except Exception:
        return None
    job = parse_job_envelope(payload)
    if job is None:
        return None
    return f"job:{job.get('command')}:{job.get('queueId')}"


if __name__ == "__main__":
    payload = json.load(sys.stdin)
    job = parse_job_envelope(payload) or payload
    print(json.dumps(materialize_job(job), indent=2, ensure_ascii=False))

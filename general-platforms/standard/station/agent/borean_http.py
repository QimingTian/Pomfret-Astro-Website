"""HTTPS for the Station agent.

Pomfret's agent uses plain urllib against pomfretastro.org (Let's Encrypt / ISRG Root X1),
which every OS and Python build trusts out of the box.

Borean hubs use www.boreanastro.com behind Cloudflare (Google Trust Services WE1). That chain
is newer; Python 3.13 on Windows and rustls-only HTTP clients may not trust it unless we also
use the Windows certificate store and a current Mozilla CA bundle.

We merge: OS trust store + bundled cacert.pem + installed certifi.
"""

from __future__ import annotations

import ssl
import sys
import urllib.request
from pathlib import Path
from typing import Optional
from urllib.parse import urlparse

_ssl_context: Optional[ssl.SSLContext] = None


def _bundled_ca_path() -> Optional[str]:
    path = Path(__file__).resolve().with_name("cacert.pem")
    return str(path) if path.is_file() else None


def https_ssl_context() -> ssl.SSLContext:
    global _ssl_context
    if _ssl_context is not None:
        return _ssl_context

    # Same starting point as Pomfret's plain urllib on Windows (Schannel / OS roots).
    ctx = ssl.create_default_context()

    bundled = _bundled_ca_path()
    if bundled:
        ctx.load_verify_locations(cafile=bundled)

    try:
        import certifi

        ctx.load_verify_locations(cafile=certifi.where())
    except ImportError:
        pass

    _ssl_context = ctx
    return _ssl_context


def urlopen(req: urllib.request.Request, *, timeout: float):
    if urlparse(req.full_url).scheme == "https":
        return urllib.request.urlopen(req, timeout=timeout, context=https_ssl_context())
    return urllib.request.urlopen(req, timeout=timeout)


def ssl_ca_status() -> str:
    parts: list[str] = []
    if sys.platform == "win32":
        parts.append("Windows trust store")
    else:
        parts.append("system default")
    bundled = _bundled_ca_path()
    if bundled:
        parts.append(f"bundled cacert.pem")
    try:
        import certifi

        parts.append(f"certifi ({certifi.where()})")
    except ImportError:
        parts.append("certifi not installed")
    return " + ".join(parts)

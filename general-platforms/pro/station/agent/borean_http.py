"""HTTPS helpers for the Station agent (Windows Python often lacks system CA roots)."""

from __future__ import annotations

import ssl
import urllib.request
from typing import Optional
from urllib.parse import urlparse

_ssl_context: Optional[ssl.SSLContext] = None


def https_ssl_context() -> ssl.SSLContext:
    global _ssl_context
    if _ssl_context is not None:
        return _ssl_context
    try:
        import certifi

        _ssl_context = ssl.create_default_context(cafile=certifi.where())
    except ImportError:
        _ssl_context = ssl.create_default_context()
    return _ssl_context


def urlopen(req: urllib.request.Request, *, timeout: float):
    """urllib.request.urlopen with certifi CA bundle for https URLs."""
    if urlparse(req.full_url).scheme == "https":
        return urllib.request.urlopen(req, timeout=timeout, context=https_ssl_context())
    return urllib.request.urlopen(req, timeout=timeout)


def ssl_ca_status() -> str:
    try:
        import certifi

        return f"certifi ({certifi.where()})"
    except ImportError:
        return "system default (install certifi on Windows: pip install certifi)"

"""
Upload sequence captures to Google Drive (service account).
Share the target folder (or Shared Drive) with the service account email (Content manager or Editor).
"""

from __future__ import annotations

import io
import os
from typing import Optional, Tuple

# All Sky Camera — https://drive.google.com/drive/folders/1aRm-ly3N8CxEUKwUzHQzvumySJrNKXDV
DEFAULT_SEQUENCE_ROOT_FOLDER_ID = '1aRm-ly3N8CxEUKwUzHQzvumySJrNKXDV'

_DRIVE_SERVICE = None


def sequence_root_folder_id() -> str:
    return os.environ.get('GOOGLE_DRIVE_SEQUENCE_FOLDER_ID', DEFAULT_SEQUENCE_ROOT_FOLDER_ID)


def credentials_path() -> Optional[str]:
    path = os.environ.get('GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON') or os.environ.get(
        'GOOGLE_APPLICATION_CREDENTIALS'
    )
    if path and os.path.isfile(path):
        return path
    return None


def drive_configured() -> bool:
    return credentials_path() is not None


def folder_web_url(folder_id: str) -> str:
    return f'https://drive.google.com/drive/folders/{folder_id}'


def get_drive_service():
    global _DRIVE_SERVICE
    if _DRIVE_SERVICE is not None:
        return _DRIVE_SERVICE

    creds_file = credentials_path()
    if not creds_file:
        raise RuntimeError(
            'Google Drive credentials not found. On the Pi, set '
            'GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON to the service account JSON path.'
        )

    from google.oauth2 import service_account
    from googleapiclient.discovery import build

    creds = service_account.Credentials.from_service_account_file(
        creds_file,
        scopes=['https://www.googleapis.com/auth/drive'],
    )
    _DRIVE_SERVICE = build('drive', 'v3', credentials=creds, cache_discovery=False)
    return _DRIVE_SERVICE


def get_or_create_folder(parent_id: str, name: str) -> str:
    """Return existing subfolder by name under parent, or create it."""
    service = get_drive_service()
    safe_name = name.replace("'", "\\'")
    query = (
        f"'{parent_id}' in parents and name = '{safe_name}' "
        "and mimeType = 'application/vnd.google-apps.folder' and trashed = false"
    )
    results = (
        service.files()
        .list(
            q=query,
            fields='files(id,name)',
            supportsAllDrives=True,
            includeItemsFromAllDrives=True,
            pageSize=1,
        )
        .execute()
    )
    files = results.get('files', [])
    if files:
        return files[0]['id']
    return create_folder(parent_id, name)


def create_folder(parent_id: str, name: str) -> str:
    """Create a subfolder; return its Drive folder id."""
    service = get_drive_service()
    metadata = {
        'name': name,
        'mimeType': 'application/vnd.google-apps.folder',
        'parents': [parent_id],
    }
    folder = service.files().create(
        body=metadata,
        fields='id',
        supportsAllDrives=True,
    ).execute()
    return folder['id']


def upload_bytes(folder_id: str, filename: str, data: bytes, mime_type: str) -> str:
    """Upload file bytes into folder_id; return Drive file id."""
    from googleapiclient.http import MediaIoBaseUpload

    service = get_drive_service()
    metadata = {'name': filename, 'parents': [folder_id]}
    media = MediaIoBaseUpload(io.BytesIO(data), mimetype=mime_type, resumable=True)
    created = service.files().create(
        body=metadata,
        media_body=media,
        fields='id',
        supportsAllDrives=True,
    ).execute()
    return created['id']


def encode_image(img, file_format: str) -> Tuple[bytes, str, str]:
    """PIL Image → (bytes, mime_type, extension without dot)."""
    buf = io.BytesIO()
    fmt = file_format.upper()
    if fmt == 'JPEG':
        img.save(buf, 'JPEG', quality=95)
        return buf.getvalue(), 'image/jpeg', 'jpg'
    if fmt == 'PNG':
        img.save(buf, 'PNG')
        return buf.getvalue(), 'image/png', 'png'
    if fmt == 'TIFF':
        img.save(buf, 'TIFF')
        return buf.getvalue(), 'image/tiff', 'tiff'
    raise ValueError(f'Unsupported file format: {file_format}')

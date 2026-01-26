import os
import re
import shutil
import sqlite3
import uuid
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from fastapi import FastAPI, File, Header, HTTPException, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.getenv("DATA_DIR", os.path.join(BASE_DIR, "data", "projects"))
DB_PATH = os.getenv("DB_PATH", os.path.join(BASE_DIR, "data", "app.db"))
ADMIN_PASSWORD = os.getenv("ADMIN_PASSWORD")


@asynccontextmanager
async def lifespan(app: FastAPI):
    ensure_dirs()
    init_db()
    yield


app = FastAPI(lifespan=lifespan)


class ProjectUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    icon: Optional[str] = None


class VersionUpdate(BaseModel):
    display_name: str


class AdminCheck(BaseModel):
    password: str


def ensure_dirs() -> None:
    os.makedirs(DATA_DIR, exist_ok=True)
    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def get_conn() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def init_db() -> None:
    with get_conn() as conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS projects (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                description TEXT NOT NULL,
                icon TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS versions (
                id TEXT PRIMARY KEY,
                project_id TEXT NOT NULL,
                stored_filename TEXT NOT NULL,
                original_filename TEXT NOT NULL,
                display_name TEXT NOT NULL,
                created_at TEXT NOT NULL,
                FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE
            )
            """
        )
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_versions_project ON versions(project_id)"
        )


def is_admin(password: Optional[str]) -> bool:
    return bool(password) and password == ADMIN_PASSWORD


def require_admin(password: Optional[str]) -> None:
    if not is_admin(password):
        raise HTTPException(status_code=401, detail="Admin password required")


def validate_html_file(file: UploadFile) -> None:
    filename = (file.filename or "").lower()
    if not filename.endswith(".html") and file.content_type != "text/html":
        raise HTTPException(status_code=400, detail="Only .html files are allowed")




def safe_basename(filename: str) -> str:
    base = os.path.basename(filename)
    return re.sub(r"[^A-Za-z0-9._-]+", "_", base)


def extract_title(html_text: str) -> Optional[str]:
    match = re.search(r"<title>(.*?)</title>", html_text, re.IGNORECASE | re.DOTALL)
    if not match:
        return None
    title = re.sub(r"\s+", " ", match.group(1)).strip()
    return title[:60] if title else None


def extract_meta_description(html_text: str) -> Optional[str]:
    meta_match = re.search(
        r'<meta[^>]+(?:name|property)=["\']description["\'][^>]*>',
        html_text,
        re.IGNORECASE | re.DOTALL,
    )
    if not meta_match:
        meta_match = re.search(
            r'<meta[^>]+property=["\']og:description["\'][^>]*>',
            html_text,
            re.IGNORECASE | re.DOTALL,
        )
    if not meta_match:
        return None
    content_match = re.search(
        r'content=["\'](.*?)["\']', meta_match.group(0), re.IGNORECASE | re.DOTALL
    )
    if not content_match:
        return None
    desc = re.sub(r"\s+", " ", content_match.group(1)).strip()
    return desc[:160] if desc else None


def extract_text_snippet(html_text: str) -> Optional[str]:
    cleaned = re.sub(r"<script.*?</script>", " ", html_text, flags=re.IGNORECASE | re.DOTALL)
    cleaned = re.sub(r"<style.*?</style>", " ", cleaned, flags=re.IGNORECASE | re.DOTALL)
    cleaned = re.sub(r"<[^>]+>", " ", cleaned)
    cleaned = re.sub(r"\s+", " ", cleaned).strip()
    if not cleaned:
        return None
    return cleaned[:160]


def row_to_dict(row: Optional[sqlite3.Row]) -> Optional[Dict[str, Any]]:
    return dict(row) if row else None


def rows_to_list(rows: List[sqlite3.Row]) -> List[Dict[str, Any]]:
    return [dict(r) for r in rows]


def build_fallback_metadata(html_text: str, filename: str) -> tuple[str, str, str]:
    title = extract_title(html_text)
    base = os.path.splitext(safe_basename(filename))[0] or "Untitled"
    name = title or base or "Untitled"
    desc = (
        extract_meta_description(html_text)
        or extract_text_snippet(html_text)
        or f"{name} HTML project"
    )
    return name[:60], desc[:160], "📁"


def sanitize_icon(value: str) -> str:
    icon = (value or "").strip()
    if not icon:
        return "📁"
    return icon[:2]


async def generate_metadata(html_text: str, filename: str) -> tuple[str, str, str]:
    return build_fallback_metadata(html_text, filename)


@app.get("/")
def index() -> FileResponse:
    return FileResponse(os.path.join(BASE_DIR, "index.html"))


@app.post("/api/admin/verify")
def verify_admin(payload: AdminCheck) -> Dict[str, Any]:
    if payload.password != ADMIN_PASSWORD:
        raise HTTPException(status_code=401, detail="Invalid password")
    return {"ok": True}


@app.get("/api/projects")
def list_projects(x_admin_password: Optional[str] = Header(None)) -> Dict[str, Any]:
    admin = is_admin(x_admin_password)
    items: List[Dict[str, Any]] = []
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT * FROM projects ORDER BY updated_at DESC"
        ).fetchall()
        for row in rows:
            latest = conn.execute(
                """
                SELECT id, display_name, created_at
                FROM versions
                WHERE project_id = ?
                ORDER BY created_at DESC
                LIMIT 1
                """,
                (row["id"],),
            ).fetchone()
            count_row = conn.execute(
                "SELECT COUNT(1) AS c FROM versions WHERE project_id = ?",
                (row["id"],),
            ).fetchone()
            count = int(count_row["c"]) if count_row else 0

            item: Dict[str, Any] = {
                "id": row["id"],
                "name": row["name"],
                "description": row["description"],
                "icon": row["icon"] or "📁",
                "created_at": row["created_at"],
                "updated_at": row["updated_at"],
                "latest_version": row_to_dict(latest),
            }
            if admin:
                item["versions_count"] = count
            items.append(item)

    return {"projects": items}


@app.get("/api/projects/{project_id}")
def get_project(project_id: str, x_admin_password: Optional[str] = Header(None)) -> Dict[str, Any]:
    admin = is_admin(x_admin_password)
    with get_conn() as conn:
        proj = conn.execute(
            "SELECT * FROM projects WHERE id = ?", (project_id,)
        ).fetchone()
        if not proj:
            raise HTTPException(status_code=404, detail="Project not found")

        latest = conn.execute(
            """
            SELECT id, display_name, created_at
            FROM versions
            WHERE project_id = ?
            ORDER BY created_at DESC
            LIMIT 1
            """,
            (project_id,),
        ).fetchone()

        data: Dict[str, Any] = {
            "id": proj["id"],
            "name": proj["name"],
            "description": proj["description"],
            "icon": proj["icon"] or "📁",
            "created_at": proj["created_at"],
            "updated_at": proj["updated_at"],
            "latest_version": row_to_dict(latest),
        }

        if admin:
            versions = conn.execute(
                """
                SELECT id, display_name, original_filename, created_at
                FROM versions
                WHERE project_id = ?
                ORDER BY created_at DESC
                """,
                (project_id,),
            ).fetchall()
            data["versions"] = rows_to_list(versions)

        return data


@app.post("/api/projects")
async def create_project(
    file: UploadFile = File(...),
    x_admin_password: Optional[str] = Header(None),
) -> Dict[str, Any]:
    require_admin(x_admin_password)
    validate_html_file(file)

    content = await file.read()
    html_text = content.decode("utf-8", errors="ignore")
    name, desc, icon = await generate_metadata(html_text, file.filename or "upload.html")

    project_id = uuid.uuid4().hex
    version_id = uuid.uuid4().hex
    stored_filename = f"{version_id}.html"
    original_filename = safe_basename(file.filename or "upload.html")

    project_dir = os.path.join(DATA_DIR, project_id)
    os.makedirs(project_dir, exist_ok=True)
    file_path = os.path.join(project_dir, stored_filename)

    with open(file_path, "wb") as f:
        f.write(content)

    now = now_iso()

    with get_conn() as conn:
        conn.execute(
            """
            INSERT INTO projects (id, name, description, icon, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (project_id, name, desc, icon, now, now),
        )
        conn.execute(
            """
            INSERT INTO versions (id, project_id, stored_filename, original_filename, display_name, created_at)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (version_id, project_id, stored_filename, original_filename, original_filename, now),
        )

    return {"id": project_id, "name": name, "description": desc, "icon": icon}


@app.post("/api/projects/{project_id}/versions")
async def add_version(
    project_id: str,
    file: UploadFile = File(...),
    x_admin_password: Optional[str] = Header(None),
) -> Dict[str, Any]:
    require_admin(x_admin_password)
    validate_html_file(file)

    content = await file.read()
    original_filename = safe_basename(file.filename or "upload.html")

    with get_conn() as conn:
        proj = conn.execute(
            "SELECT id FROM projects WHERE id = ?", (project_id,)
        ).fetchone()
        if not proj:
            raise HTTPException(status_code=404, detail="Project not found")

    version_id = uuid.uuid4().hex
    stored_filename = f"{version_id}.html"

    project_dir = os.path.join(DATA_DIR, project_id)
    os.makedirs(project_dir, exist_ok=True)
    file_path = os.path.join(project_dir, stored_filename)

    with open(file_path, "wb") as f:
        f.write(content)

    now = now_iso()

    with get_conn() as conn:
        conn.execute(
            """
            INSERT INTO versions (id, project_id, stored_filename, original_filename, display_name, created_at)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (version_id, project_id, stored_filename, original_filename, original_filename, now),
        )
        conn.execute(
            "UPDATE projects SET updated_at = ? WHERE id = ?",
            (now, project_id),
        )

    return {"id": version_id}


@app.patch("/api/projects/{project_id}")
def update_project(
    project_id: str,
    payload: ProjectUpdate,
    x_admin_password: Optional[str] = Header(None),
) -> Dict[str, Any]:
    require_admin(x_admin_password)

    if not payload.name and not payload.description and not payload.icon:
        raise HTTPException(status_code=400, detail="No updates provided")

    with get_conn() as conn:
        proj = conn.execute(
            "SELECT id FROM projects WHERE id = ?", (project_id,)
        ).fetchone()
        if not proj:
            raise HTTPException(status_code=404, detail="Project not found")

        updates: List[str] = []
        values: List[Any] = []

        if payload.name is not None:
            name = payload.name.strip()
            if not name:
                raise HTTPException(status_code=400, detail="Name required")
            updates.append("name = ?")
            values.append(name)

        if payload.description is not None:
            desc = payload.description.strip()
            if not desc:
                raise HTTPException(status_code=400, detail="Description required")
            updates.append("description = ?")
            values.append(desc)

        if payload.icon is not None:
            icon = sanitize_icon(payload.icon)
            updates.append("icon = ?")
            values.append(icon)

        now = now_iso()
        updates.append("updated_at = ?")
        values.append(now)
        values.append(project_id)
        conn.execute(
            f"UPDATE projects SET {', '.join(updates)} WHERE id = ?",
            values,
        )

    return {"ok": True}


@app.patch("/api/versions/{version_id}")
def update_version(
    version_id: str,
    payload: VersionUpdate,
    x_admin_password: Optional[str] = Header(None),
) -> Dict[str, Any]:
    require_admin(x_admin_password)
    display_name = payload.display_name.strip()
    if not display_name:
        raise HTTPException(status_code=400, detail="Display name required")

    with get_conn() as conn:
        ver = conn.execute(
            "SELECT id FROM versions WHERE id = ?", (version_id,)
        ).fetchone()
        if not ver:
            raise HTTPException(status_code=404, detail="Version not found")

        conn.execute(
            "UPDATE versions SET display_name = ? WHERE id = ?",
            (display_name, version_id),
        )

    return {"ok": True}


@app.delete("/api/projects/{project_id}")
def delete_project(project_id: str, x_admin_password: Optional[str] = Header(None)) -> Dict[str, Any]:
    require_admin(x_admin_password)

    with get_conn() as conn:
        proj = conn.execute(
            "SELECT id FROM projects WHERE id = ?", (project_id,)
        ).fetchone()
        if not proj:
            raise HTTPException(status_code=404, detail="Project not found")

        conn.execute("DELETE FROM projects WHERE id = ?", (project_id,))

    project_dir = os.path.join(DATA_DIR, project_id)
    if os.path.isdir(project_dir):
        shutil.rmtree(project_dir, ignore_errors=True)

    return {"ok": True}


@app.delete("/api/versions/{version_id}")
def delete_version(version_id: str, x_admin_password: Optional[str] = Header(None)) -> Dict[str, Any]:
    require_admin(x_admin_password)

    with get_conn() as conn:
        ver = conn.execute(
            "SELECT project_id, stored_filename FROM versions WHERE id = ?",
            (version_id,),
        ).fetchone()
        if not ver:
            raise HTTPException(status_code=404, detail="Version not found")

        conn.execute("DELETE FROM versions WHERE id = ?", (version_id,))

    file_path = os.path.join(DATA_DIR, ver["project_id"], ver["stored_filename"])
    if os.path.isfile(file_path):
        os.remove(file_path)

    return {"ok": True}


@app.get("/projects/{project_id}/latest")
def serve_latest(project_id: str) -> FileResponse:
    with get_conn() as conn:
        ver = conn.execute(
            """
            SELECT stored_filename
            FROM versions
            WHERE project_id = ?
            ORDER BY created_at DESC
            LIMIT 1
            """,
            (project_id,),
        ).fetchone()
        if not ver:
            raise HTTPException(status_code=404, detail="No versions found")

    file_path = os.path.join(DATA_DIR, project_id, ver["stored_filename"])
    if not os.path.isfile(file_path):
        raise HTTPException(status_code=404, detail="File missing")

    return FileResponse(file_path, media_type="text/html")


@app.get("/projects/{project_id}/versions/{version_id}")
def serve_version(project_id: str, version_id: str) -> FileResponse:
    with get_conn() as conn:
        ver = conn.execute(
            """
            SELECT stored_filename
            FROM versions
            WHERE id = ? AND project_id = ?
            """,
            (version_id, project_id),
        ).fetchone()
        if not ver:
            raise HTTPException(status_code=404, detail="Version not found")

    file_path = os.path.join(DATA_DIR, project_id, ver["stored_filename"])
    if not os.path.isfile(file_path):
        raise HTTPException(status_code=404, detail="File missing")

    return FileResponse(file_path, media_type="text/html")

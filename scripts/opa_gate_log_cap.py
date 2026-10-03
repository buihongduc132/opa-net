#!/usr/bin/env python3
"""
scripts/opa_gate_log_cap.py — Enforce log size cap for opa-gate audit logs.
Ensures /var/log/opa-gate/audit.jsonl does not exceed 10MB, maintaining max 3 rotated archives.
"""

import gzip
import os
import shutil
import sys

DEFAULT_LOG_PATH = "/var/log/opa-gate/audit.jsonl"
MAX_BYTES = 10 * 1024 * 1024  # 10MB
MAX_FILES = 3


def ensure_log_perms(log_path: str = DEFAULT_LOG_PATH) -> None:
    """Ensure audit log exists with mode 640 and ownership root:root."""
    parent = os.path.dirname(log_path)
    if parent:
        os.makedirs(parent, exist_ok=True)
    if not os.path.exists(log_path):
        try:
            flags = os.O_WRONLY | os.O_CREAT | os.O_APPEND
            fd = os.open(log_path, flags, 0o640)
            os.close(fd)
        except OSError:
            pass
    try:
        os.chmod(log_path, 0o640)
    except OSError:
        pass
    try:
        shutil.chown(log_path, user="root", group="root")
    except (PermissionError, OSError):
        pass


def rotate_log(log_path: str = DEFAULT_LOG_PATH, max_bytes: int = MAX_BYTES, max_files: int = MAX_FILES) -> bool:
    if not os.path.exists(log_path):
        ensure_log_perms(log_path)
        return False

    try:
        size = os.path.getsize(log_path)
    except OSError:
        return False

    if size < max_bytes:
        return False

    # Perform copytruncate rotation
    # Shift existing archives: .3.gz -> delete, .2.gz -> .3.gz, .1.gz -> .2.gz
    for i in range(max_files, 0, -1):
        gz_path = f"{log_path}.{i}.gz"
        if i == max_files and os.path.exists(gz_path):
            try:
                os.remove(gz_path)
            except OSError:
                pass
        elif os.path.exists(gz_path):
            next_gz = f"{log_path}.{i + 1}.gz"
            try:
                os.rename(gz_path, next_gz)
            except OSError:
                pass

    # Copy current log to .1 and truncate original
    temp_target = f"{log_path}.1"
    try:
        with open(log_path, "r+b") as src, open(temp_target, "wb") as dst:
            shutil.copyfileobj(src, dst)
            src.seek(0)
            src.truncate(0)
        ensure_log_perms(log_path)
    except PermissionError:
        return False
    except Exception as e:
        sys.stderr.write(f"Error truncating {log_path}: {e}\n")
        return False

    # Compress temp_target to .1.gz
    gz_target = f"{log_path}.1.gz"
    try:
        with open(temp_target, "rb") as f_in, gzip.open(gz_target, "wb") as f_out:
            shutil.copyfileobj(f_in, f_out)
        os.remove(temp_target)
        try:
            os.chmod(gz_target, 0o640)
            shutil.chown(gz_target, user="root", group="root")
        except (PermissionError, OSError):
            pass
    except Exception as e:
        sys.stderr.write(f"Error compressing {temp_target}: {e}\n")

    return True


if __name__ == "__main__":
    path = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_LOG_PATH
    ensure_log_perms(path)
    rotated = rotate_log(path)
    if rotated:
        print(f"Rotated {path} successfully (exceeded {MAX_BYTES} bytes).")
    else:
        print(f"{path} within size cap or absent.")

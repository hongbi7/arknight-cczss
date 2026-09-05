"""Helpers for replacing generated text files without in-place truncation."""

import json
import os
import tempfile
from pathlib import Path


def atomic_write_text(path, text):
    """Write UTF-8/LF text to a sibling temporary file, then replace path."""
    destination = Path(path)
    destination.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary_path = tempfile.mkstemp(
        prefix=f".{destination.name}.",
        suffix=".tmp",
        dir=destination.parent,
    )
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8", newline="\n") as output:
            output.write(text)
        os.replace(temporary_path, destination)
    except BaseException:
        try:
            os.close(descriptor)
        except OSError:
            pass
        try:
            os.unlink(temporary_path)
        except FileNotFoundError:
            pass
        raise


def atomic_write_json(path, value, *, trailing_newline=False, **options):
    payload = json.dumps(value, ensure_ascii=False, **options)
    if trailing_newline:
        payload += "\n"
    atomic_write_text(path, payload)

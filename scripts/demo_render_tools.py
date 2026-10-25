"""Resolve media executables without requiring one developer's installation path."""
import os
import shutil
import sys
from pathlib import Path


def executable(name):
    path = os.environ.get(name.upper()) or shutil.which(name)
    if path:
        return path
    bundled = Path(sys.executable).parent / "Lib/site-packages/static_ffmpeg/bin/win32" / (name + ".exe")
    if bundled.is_file():
        return str(bundled)
    raise RuntimeError(f"Install {name} or set {name.upper()} to its executable path")

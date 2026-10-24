#!/usr/bin/env python3
import os
import sys

current_dir = os.path.dirname(os.path.abspath(__file__))
pkg_dir = os.path.join(current_dir, "app_package")
if pkg_dir not in sys.path:
    sys.path.insert(0, pkg_dir)
if current_dir not in sys.path:
    sys.path.insert(0, current_dir)

port = int(os.environ.get("X_ZOHO_CATALYST_LISTEN_PORT", os.environ.get("PORT", 9000)))
print(f"[AppSail] Starting production server on port {port}...", flush=True)

try:
    from backend.app import app
    print("[AppSail] Flask backend imported successfully.", flush=True)
    from werkzeug.serving import run_simple
    run_simple("0.0.0.0", port, app, threaded=True)
except Exception as e:
    import traceback
    print(f"[AppSail Startup Error] {e}", file=sys.stderr, flush=True)
    traceback.print_exc(file=sys.stderr)
    sys.exit(1)

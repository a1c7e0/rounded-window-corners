#!/usr/bin/env bash
set -euo pipefail
repo_root=$(cd -- "$(dirname -- "$0")/.." && pwd)
backend=${1:-wayland}
case "$backend" in
    wayland) compositor_args=(--no-x11) ;;
    x11) compositor_args=() ;;
    *) echo 'Usage: tests/run-gnome51-smoke.sh [wayland|x11]' >&2; exit 2 ;;
esac
case "$(gnome-shell --version)" in
    'GNOME Shell 51'*) ;;
    *) echo 'This smoke test requires GNOME Shell 51.' >&2; exit 2 ;;
esac
if [[ ! -f "$repo_root/_build/schemas/gschemas.compiled" ]]; then
    echo 'Build the extension and compile schemas first.' >&2
    exit 2
fi
scratch=$(mktemp -d)
trap 'rm -rf -- "$scratch"' EXIT
mkdir -p "$scratch"/{runtime,data,config,cache}
chmod 700 "$scratch/runtime"
export XDG_RUNTIME_DIR="$scratch/runtime" XDG_DATA_HOME="$scratch/data"
export XDG_CONFIG_HOME="$scratch/config" XDG_CACHE_HOME="$scratch/cache"
export GSETTINGS_BACKEND=memory GIO_USE_VFS=local GIO_USE_VOLUME_MONITOR=unix
export LIBGL_ALWAYS_SOFTWARE=1 GDK_BACKEND="$backend"
# Keep the software-rendered test independent of an installed NVIDIA EGL vendor.
if [[ -f /usr/share/glvnd/egl_vendor.d/50_mesa.json ]]; then
    export __EGL_VENDOR_LIBRARY_FILENAMES=/usr/share/glvnd/egl_vendor.d/50_mesa.json
fi
export RWC_TEST_BACKEND="$backend" RWC_TEST_EXTENSION="$repo_root/_build"
if ! timeout -k 3s 40s dbus-run-session -- gnome-shell --headless --force-animations \
    "${compositor_args[@]}" --virtual-monitor 1280x720 \
    --automation-script "$repo_root/tests/gnome51-smoke.mjs" > "$scratch/session.log" 2>&1; then
    cat "$scratch/session.log"
    exit 1
fi
if ! grep -q 'RWC_GNOME51_SMOKE_PASS' "$scratch/session.log" || \
    grep -Eq 'GNOME Shell-CRITICAL|JS ERROR|Failed to create offscreen|already disposed|\(gnome-shell:[0-9]+\).*CRITICAL' "$scratch/session.log"; then
    cat "$scratch/session.log"
    exit 1
fi
printf 'GNOME 51 %s smoke test passed.\n' "$backend"

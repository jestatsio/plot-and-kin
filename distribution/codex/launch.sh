#!/bin/sh
# The release assembler replaces the fixed platform and checksum placeholders.
# All runtime bytes are already present in this plugin. No download is performed.
set -eu
umask 077
pk_platform='__PK_PLATFORM__'
pk_expected='__PK_SHA256__'
pk_root=$(CDPATH= cd -- "$(/usr/bin/dirname "$0")/.." && pwd)
pk_payload="$pk_root/runtime.zip"
pk_runtime="$pk_root/runtime-$pk_expected"
pk_node="$pk_runtime/plot-and-kin-codex/plugins/plot-and-kin/bin/node"
pk_cli="$pk_runtime/plot-and-kin-codex/plugins/plot-and-kin/dist/cli.js"
pk_lock="$pk_root/.runtime-lock"
pk_stage=
pk_locked=0
pk_fail() { printf '%s\n' "Plot & Kin: $1" >&2; exit 1; }
pk_cleanup() {
  if [ -n "$pk_stage" ]; then /bin/rm -rf "$pk_stage"; fi
  if [ "$pk_locked" = 1 ]; then /bin/rmdir "$pk_lock"; fi
}
trap pk_cleanup EXIT
trap 'exit 130' INT TERM HUP
case "$(/usr/bin/uname -s)-$(/usr/bin/uname -m)" in
  Darwin-arm64) [ "$pk_platform" = darwin-arm64 ] || pk_fail 'Install the Mac Apple Silicon entry.' ;;
  Darwin-x86_64) [ "$pk_platform" = darwin-x64 ] || pk_fail 'Install the Mac Intel entry.' ;;
  *) pk_fail 'This package supports only its named Mac architecture.' ;;
esac
[ -f "$pk_payload" ] && [ ! -L "$pk_payload" ] || pk_fail 'Bundled runtime archive is missing or unsafe. Reinstall the plugin.'
pk_actual=$(/usr/bin/shasum -a 256 "$pk_payload")
[ "${pk_actual%% *}" = "$pk_expected" ] || pk_fail 'Bundled runtime checksum failed. Reinstall the plugin.'
pk_ready() {
  [ -d "$pk_runtime" ] && [ ! -L "$pk_runtime" ] && [ -x "$pk_node" ] && [ -f "$pk_cli" ] &&
    [ -f "$pk_runtime/.payload-sha256" ] && [ "$(/bin/cat "$pk_runtime/.payload-sha256")" = "$pk_expected" ]
}
if ! pk_ready; then
  [ -w "$pk_root" ] || pk_fail 'Plugin cache is read-only. Reinstall into a writable client cache.'
  pk_attempt=0
  until /bin/mkdir "$pk_lock" 2>/dev/null; do
    pk_attempt=$((pk_attempt + 1))
    [ "$pk_attempt" -lt 60 ] || pk_fail 'Runtime extraction is busy. Close other sessions and reinstall if a previous installation was interrupted.'
    /bin/sleep 1
  done
  pk_locked=1
  if ! pk_ready; then
    [ ! -e "$pk_runtime" ] && [ ! -L "$pk_runtime" ] || pk_fail 'Runtime cache is damaged. Reinstall the plugin. Saved cases remain outside the plugin.'
    pk_stage=$(/usr/bin/mktemp -d "$pk_root/.runtime-stage.XXXXXX")
    /usr/bin/unzip -q "$pk_payload" -d "$pk_stage"
    [ -x "$pk_stage/plot-and-kin-codex/plugins/plot-and-kin/bin/node" ] || pk_fail 'Runtime archive is incomplete.'
    printf '%s\n' "$pk_expected" > "$pk_stage/.payload-sha256"
    /bin/mv "$pk_stage" "$pk_runtime"
    pk_stage=
  fi
  /bin/rmdir "$pk_lock"
  pk_locked=0
fi
exec "$pk_node" --disable-warning=ExperimentalWarning "$pk_cli" "$@"

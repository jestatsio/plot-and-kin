#!/bin/sh
# macOS bootstrap. Downloads a tested runtime bundle, then starts guided setup.
# Optional: PLOT_AND_KIN_VERSION=0.1.0 sh install.sh [setup arguments]
set -eu
umask 077
fail() { printf '\nPlot & Kin: %s\n' "$1" >&2; exit 1; }
[ "$(uname -s)" = Darwin ] || fail 'This installer supports macOS. Windows uses install.ps1.'
case "$(uname -m)" in
  arm64) pk_arch=arm64 ;;
  x86_64) pk_arch=x64 ;;
  *) fail 'This Mac architecture is not supported.' ;;
esac
for pk_tool in curl tar shasum mktemp awk; do
  command -v "$pk_tool" >/dev/null 2>&1 || fail "Required macOS utility is missing: $pk_tool"
done
pk_base=https://github.com/jestatsio/plot-and-kin/releases
pk_root=${PLOT_AND_KIN_INSTALL_ROOT:-"$HOME/.plot-and-kin/runtime"}
mkdir -p "$pk_root/versions"
# A lock prevents two setup commands from racing to activate the same version.
mkdir "$pk_root/install.lock" 2>/dev/null || fail 'Another installation is active. If it was interrupted, remove ~/.plot-and-kin/runtime/install.lock and try again.'
pk_work=''
cleanup() { [ -z "$pk_work" ] || rm -rf "$pk_work"; rmdir "$pk_root/install.lock" 2>/dev/null || true; }
trap cleanup EXIT
trap 'exit 130' HUP INT TERM
pk_work=$(mktemp -d "$pk_root/.install.XXXXXX")
download() {
  curl --fail --silent --show-error --location --proto '=https' --proto-redir '=https' --connect-timeout 20 --max-time 300 "$1" --output "$2" ||
    fail 'A tested release could not be downloaded. Check your connection and the GitHub Releases page. Your research and client settings have not been changed.'
}
pk_version=${PLOT_AND_KIN_VERSION:-}
if [ -z "$pk_version" ]; then
  download "$pk_base/latest/download/version.txt" "$pk_work/version.txt"
  pk_version=$(cat "$pk_work/version.txt")
fi
case "$pk_version" in *[!0-9a-zA-Z.-]*) fail 'The release version is invalid.' ;; esac
printf '%s\n' "$pk_version" | LC_ALL=C awk '/^[0-9]+\.[0-9]+\.[0-9]+(-[a-zA-Z0-9.-]+)?$/ {valid=1} END {exit !valid}' || fail 'The release version is invalid.'
pk_asset="plot-and-kin-$pk_version-darwin-$pk_arch.tar.gz"
pk_url="$pk_base/download/v$pk_version"
printf 'Downloading Plot & Kin %s for macOS %s…\n' "$pk_version" "$pk_arch"
download "$pk_url/SHA256SUMS.txt" "$pk_work/SHA256SUMS.txt"
download "$pk_url/$pk_asset" "$pk_work/$pk_asset"
pk_expected=$(awk -v name="$pk_asset" '$2 == name {print $1}' "$pk_work/SHA256SUMS.txt")
[ "${#pk_expected}" = 64 ] || fail 'The release does not contain one valid checksum for this Mac.'
case "$pk_expected" in *[!0-9a-f]*) fail 'The release checksum is invalid.' ;; esac
pk_actual=$(shasum -a 256 "$pk_work/$pk_asset" | awk '{print $1}')
[ "$pk_actual" = "$pk_expected" ] || fail 'The download checksum did not match. Nothing was activated. Run the installer again to retry the download.'
# Reject absolute paths and parent traversal before extracting even a verified archive.
tar -tzf "$pk_work/$pk_asset" > "$pk_work/contents.txt"
LC_ALL=C awk '/^\// || /(^|\/)\.\.(\/|$)/ || !/^plot-and-kin(\/|$)/ {bad=1} END {exit bad}' "$pk_work/contents.txt" || fail 'The release archive contains unsafe paths.'
tar -xzf "$pk_work/$pk_asset" -C "$pk_work"
pk_target="$pk_root/versions/$pk_version-darwin-$pk_arch"
pk_extracted="$pk_work/plot-and-kin"
[ -x "$pk_extracted/bin/node" ] && [ -f "$pk_extracted/dist/cli.js" ] || fail 'The release is missing required files.'
"$pk_extracted/bin/node" "$pk_extracted/scripts/smoke-release.mjs" "$pk_version" "darwin-$pk_arch" || fail 'The downloaded runtime did not pass its health check. Existing installations are preserved.'
printf '%s\n' "$pk_expected" > "$pk_extracted/.archive-sha256"
if [ -e "$pk_target" ]; then
  [ -f "$pk_target/.archive-sha256" ] && [ "$(cat "$pk_target/.archive-sha256")" = "$pk_expected" ] || fail 'This version already exists with different contents. Existing installations were preserved. Choose a newer release or inspect the version directory.'
  "$pk_target/bin/node" "$pk_target/scripts/smoke-release.mjs" "$pk_version" "darwin-$pk_arch" || fail 'The existing runtime failed its health check. Your research is preserved. Move the affected runtime version directory aside and run setup again.'
else
  mv "$pk_extracted" "$pk_target"
fi
cleanup
pk_work=''
trap - EXIT HUP INT TERM
printf '\nRuntime ready. Starting guided setup…\n'
# `curl | sh` uses stdin for the script. Reconnect setup to the terminal when present.
if ( : </dev/tty ) 2>/dev/null; then
  "$pk_target/bin/node" "$pk_target/dist/cli.js" setup "$@" </dev/tty
else
  "$pk_target/bin/node" "$pk_target/dist/cli.js" setup "$@"
fi

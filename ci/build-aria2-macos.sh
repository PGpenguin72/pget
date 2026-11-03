#!/bin/sh
# Build aria2c for macOS on a GitHub macOS runner (native arch of the runner).
#
#   sh ci/build-aria2-macos.sh <x64|arm64>
#
# Output: dist-aria2/aria2c-macos-<arch>.tar.gz
#
# Linking strategy (goal: no Homebrew dylibs at runtime):
#   - TLS:     AppleTLS (Security.framework), no OpenSSL.
#   - c-ares:  built from source, static.
#   - expat:   built from source, static.
#   - zlib, SQLite: system libraries from the macOS SDK (/usr/lib, always present).
#   - libssh2 (SFTP): disabled on macOS; it would drag in OpenSSL. Rarely needed.
# The final `otool -L` check fails the build if anything outside /usr/lib or
# /System is linked.
set -eu

ARCH_LABEL=${1:?usage: build-aria2-macos.sh <x64|arm64>}
CI_DIR=$(cd "$(dirname "$0")" && pwd)
REPO_DIR=$(dirname "$CI_DIR")
WORK=${RUNNER_TEMP:-/tmp}/aria2-build
PREFIX=$WORK/prefix
OUT=$REPO_DIR/dist-aria2
mkdir -p "$WORK" "$PREFIX"

export MACOSX_DEPLOYMENT_TARGET=11.0
command -v pkg-config >/dev/null 2>&1 || brew install pkgconf
command -v cmake >/dev/null 2>&1 || brew install cmake

. "$CI_DIR/aria2-common.sh"

build_cares
build_expat
SRC=$(prepare_aria2_source)

cd "$SRC"
# PKG_CONFIG_LIBDIR (not _PATH) hides Homebrew's .pc files so nothing from
# /opt/homebrew or /usr/local leaks in. zlib/sqlite3 come from the SDK, so we
# hand configure their flags directly instead of via pkg-config.
PKG_CONFIG_LIBDIR="$PREFIX/lib/pkgconfig" \
ZLIB_CFLAGS="" ZLIB_LIBS="-lz" \
SQLITE3_CFLAGS="" SQLITE3_LIBS="-lsqlite3" \
./configure \
  --prefix=/usr/local \
  --disable-nls \
  --with-appletls --without-openssl --without-gnutls \
  --without-libxml2 --with-libexpat \
  --with-libcares --with-libz --with-sqlite3 --without-libssh2 \
  --without-libgcrypt --without-libnettle --without-libgmp \
  CPPFLAGS="-I$PREFIX/include" LDFLAGS="-L$PREFIX/lib"
make -j"$(sysctl -n hw.ncpu)"
strip src/aria2c
# strip invalidates the linker's ad-hoc signature; arm64 macOS refuses to run
# unsigned code, so re-sign ad-hoc. (Real signing happens when the app is signed.)
codesign --force --sign - src/aria2c

echo "Linked libraries:"; otool -L src/aria2c
if otool -L src/aria2c | tail -n +2 | grep -v -E '^[[:space:]]*(/usr/lib/|/System/)'; then
  echo "aria2c links a non-system library (see above)" >&2; exit 1
fi

smoke_test "$SRC/src/aria2c"
package "$SRC/src/aria2c" "aria2c-macos-$ARCH_LABEL" "$SRC"

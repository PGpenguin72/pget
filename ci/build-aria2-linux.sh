#!/bin/sh
# Build a fully static aria2c (musl) for Linux. Runs INSIDE an Alpine container:
#
#   docker run --rm -v "$PWD:/repo" -w /repo alpine:3.22 sh ci/build-aria2-linux.sh <arch-label>
#
# <arch-label> is only used for the output name (x64 / arm64); the container's
# native architecture decides what is built, so run it on an x64 or arm64 runner.
# Output: dist-aria2/aria2c-linux-<arch-label>.tar.gz
#
# Static libs: OpenSSL, zlib, SQLite, expat, libssh2 from Alpine's *-static
# packages; c-ares is built from source because Alpine has no c-ares-static.
# TLS CA certificates: OpenSSL's default dir (/etc/ssl/certs) works on Debian,
# Ubuntu, Arch, Alpine, openSUSE; on Fedora/RHEL the app should pass
# --ca-certificate=/etc/pki/tls/certs/ca-bundle.crt (detect at runtime).
set -eu

ARCH_LABEL=${1:?usage: build-aria2-linux.sh <x64|arm64>}
CI_DIR=$(cd "$(dirname "$0")" && pwd)
REPO_DIR=$(dirname "$CI_DIR")
WORK=/tmp/aria2-build
PREFIX=$WORK/prefix
OUT=$REPO_DIR/dist-aria2
mkdir -p "$WORK" "$PREFIX"

apk add --no-cache \
  build-base cmake curl patch xz pkgconf linux-headers perl \
  openssl-dev openssl-libs-static \
  zlib-dev zlib-static \
  sqlite-dev sqlite-static \
  expat-dev expat-static \
  libssh2-dev libssh2-static \
  ca-certificates

. "$CI_DIR/aria2-common.sh"

build_cares
SRC=$(prepare_aria2_source)

cd "$SRC"
# ARIA2_STATIC=yes makes configure use `pkg-config --static` and link with -static.
PKG_CONFIG_PATH="$PREFIX/lib/pkgconfig" ./configure \
  --prefix=/usr/local \
  --disable-nls \
  --without-gnutls --with-openssl \
  --without-libxml2 --with-libexpat \
  --with-libcares --with-libz --with-sqlite3 --with-libssh2 \
  --without-libgcrypt --without-libnettle --without-libgmp \
  ARIA2_STATIC=yes \
  CPPFLAGS="-I$PREFIX/include" LDFLAGS="-L$PREFIX/lib"
make -j"$(nproc)"
strip src/aria2c

# Must be a static executable, otherwise it won't run on glibc distros.
if ldd src/aria2c 2>&1 | grep -q '=>'; then
  echo "aria2c is dynamically linked:" >&2; ldd src/aria2c >&2; exit 1
fi

smoke_test "$SRC/src/aria2c"
package "$SRC/src/aria2c" "aria2c-linux-$ARCH_LABEL" "$SRC"
# Let the (non-root) runner user clean up the bind-mounted output.
chmod -R a+rwX "$OUT"

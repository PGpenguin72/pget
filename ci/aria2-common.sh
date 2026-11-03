# Shared helpers for the aria2 build scripts. Source, don't execute.
# Expects: CI_DIR (this folder), WORK (scratch dir).

# shellcheck disable=SC1091
. "$CI_DIR/aria2-versions.env"

sha256_of() {
  if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | cut -d' ' -f1
  else shasum -a 256 "$1" | cut -d' ' -f1; fi
}

# fetch <url> <sha256> -> downloads into $WORK/dl and verifies the hash
fetch() {
  mkdir -p "$WORK/dl"
  out="$WORK/dl/$(basename "$1")"
  [ -f "$out" ] || curl -fsSL --retry 3 -o "$out" "$1"
  got=$(sha256_of "$out")
  if [ "$got" != "$2" ]; then
    echo "SHA256 mismatch for $1: expected $2, got $got" >&2
    exit 1
  fi
  echo "$out"
}

# Unpack aria2 and apply PGet's patch. Leaves CWD unchanged; prints source dir.
prepare_aria2_source() {
  tarball=$(fetch "$ARIA2_URL" "$ARIA2_SHA256")
  tar -xJf "$tarball" -C "$WORK"
  src="$WORK/aria2-$ARIA2_VERSION"
  (cd "$src" && patch -p1 < "$CI_DIR/aria2-max-connection.patch") >&2
  # Fail loudly if upstream code moved and the patch silently did nothing.
  grep -q '"1", 1, 128, '"'"'x'"'"'' "$src/src/OptionHandlerFactory.cc" || { echo "patch not applied" >&2; exit 1; }
  echo "$src"
}

# Static c-ares (CMake) into $PREFIX. Extra cmake args may be passed.
build_cares() {
  tarball=$(fetch "$CARES_URL" "$CARES_SHA256")
  tar -xzf "$tarball" -C "$WORK"
  cmake -S "$WORK/c-ares-$CARES_VERSION" -B "$WORK/build-cares" \
    -DCMAKE_BUILD_TYPE=Release -DCMAKE_INSTALL_PREFIX="$PREFIX" -DCMAKE_INSTALL_LIBDIR=lib \
    -DCARES_STATIC=ON -DCARES_SHARED=OFF -DCARES_BUILD_TOOLS=OFF -DCARES_BUILD_TESTS=OFF "$@"
  cmake --build "$WORK/build-cares" --parallel
  cmake --install "$WORK/build-cares"
}

# Static OpenSSL into $PREFIX (Linux). no-module 讓 legacy／default provider 直接編進
# libcrypto.a，靜態執行檔不用另外帶 legacy.so 也能 OSSL_PROVIDER_load("legacy")。
build_openssl() {
  tarball=$(fetch "$OPENSSL_URL" "$OPENSSL_SHA256")
  tar -xzf "$tarball" -C "$WORK"
  (cd "$WORK/openssl-$OPENSSL_VERSION" &&
    ./Configure no-shared no-module enable-legacy no-tests no-docs       --prefix="$PREFIX" --libdir=lib --openssldir=/etc/ssl &&
    make -j"$(nproc)" build_libs &&
    make install_dev) >&2
}

# Static expat (CMake) into $PREFIX (macOS only; Alpine ships expat-static).
build_expat() {
  tarball=$(fetch "$EXPAT_URL" "$EXPAT_SHA256")
  tar -xJf "$tarball" -C "$WORK"
  cmake -S "$WORK/expat-$EXPAT_VERSION" -B "$WORK/build-expat" \
    -DCMAKE_BUILD_TYPE=Release -DCMAKE_INSTALL_PREFIX="$PREFIX" -DCMAKE_INSTALL_LIBDIR=lib \
    -DEXPAT_SHARED_LIBS=OFF -DEXPAT_BUILD_TOOLS=OFF -DEXPAT_BUILD_EXAMPLES=OFF \
    -DEXPAT_BUILD_TESTS=OFF -DEXPAT_BUILD_DOCS=OFF "$@"
  cmake --build "$WORK/build-expat" --parallel
  cmake --install "$WORK/build-expat"
}

# Sanity-check the patched binary (runs the binary we just built, in CI).
smoke_test() {
  bin=$1
  "$bin" --version | head -n 20
  # These must be accepted by the patched option parser.
  "$bin" --max-connection-per-server=128 --min-split-size=1K --version >/dev/null
  # Unpatched aria2 rejects 129; patched should too (cap is 128). Informational only.
  if "$bin" --max-connection-per-server=129 --version >/dev/null 2>&1; then
    echo "::warning::aria2c accepted -x129; option validation may happen after --version" >&2
  fi
}

# Package: aria2c + licence + patch + source pointer, as <name>.tar.gz in $OUT.
package() {
  bin=$1; name=$2; src=$3
  stage="$WORK/stage/$name"
  mkdir -p "$stage" "$OUT"
  cp "$bin" "$stage/aria2c"
  cp "$src/COPYING" "$stage/COPYING"
  cp "$CI_DIR/aria2-max-connection.patch" "$stage/"
  cat > "$stage/SOURCE.txt" <<TXT
aria2 $ARIA2_VERSION (GPL-2.0-or-later, see COPYING), built for PGet.
Upstream source: $ARIA2_URL
Modification: aria2-max-connection.patch (raises --max-connection-per-server cap to 128,
lowers --min-split-size minimum to 1K).
Build scripts: https://github.com/PGpenguin72/pget/tree/main/ci
TXT
  tar -C "$WORK/stage" -czf "$OUT/$name.tar.gz" "$name"
  echo "Packaged $OUT/$name.tar.gz"
}

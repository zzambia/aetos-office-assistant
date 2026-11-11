#!/bin/bash
set -euo pipefail

cd "$(dirname "$0")/.."

APP_NAME="AETOS Office Assistant"
BINARY_NAME="AETOS-Office-Assistant"
BUNDLE_ID="com.aetos.office-assistant"
BUILD_DIR="macos/build"
APP_DIR="$BUILD_DIR/$APP_NAME.app"
CONTENTS="$APP_DIR/Contents"
MACOS_DIR="$CONTENTS/MacOS"
RESOURCES="$CONTENTS/Resources"

VERSION=$(node --input-type=module -e "import { VERSION } from './src/version.js'; console.log(VERSION)")

echo "Building AETOS Office Assistant $VERSION for macOS"

# Build the web assets. The app rewrites the manifest to its own HTTPS origin
# (https://localhost:38473) at runtime, matching the Windows launcher.
npm run build

rm -rf "$BUILD_DIR"
mkdir -p "$MACOS_DIR" "$RESOURCES/web"

# Compile Swift. Build the native architecture first, then attempt the other
# one so the final binary is universal when the toolchain supports it.
case "$(uname -m)" in
  arm64) ARCHS=(arm64 x86_64) ;;
  x86_64) ARCHS=(x86_64 arm64) ;;
  *) ARCHS=("$(uname -m)") ;;
esac

BINARIES=()
for ARCH in "${ARCHS[@]}"; do
  OUT="$BUILD_DIR/$BINARY_NAME-$ARCH"
  if swiftc -swift-version 5 -O -target "$ARCH-apple-macosx12.0" \
      -framework AppKit -framework Network -framework Security \
      macos/Sources/*.swift -o "$OUT" 2>"$BUILD_DIR/cc-$ARCH.log"; then
    BINARIES+=("$OUT")
  else
    echo "warning: could not compile for $ARCH (see macos/build/cc-$ARCH.log)"
  fi
done

if [ "${#BINARIES[@]}" -eq 0 ]; then
  echo "error: Swift compilation failed for all architectures" >&2
  cat "$BUILD_DIR"/cc-*.log >&2 || true
  exit 1
fi

if [ "${#BINARIES[@]}" -eq 1 ]; then
  cp "${BINARIES[0]}" "$MACOS_DIR/$BINARY_NAME"
else
  lipo -create "${BINARIES[@]}" -output "$MACOS_DIR/$BINARY_NAME"
fi
rm -f "$BUILD_DIR/$BINARY_NAME-arm64" "$BUILD_DIR/$BINARY_NAME-x86_64"

cat > "$CONTENTS/Info.plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleDevelopmentRegion</key><string>en</string>
  <key>CFBundleExecutable</key><string>$BINARY_NAME</string>
  <key>CFBundleIdentifier</key><string>$BUNDLE_ID</string>
  <key>CFBundleInfoDictionaryVersion</key><string>6.0</string>
  <key>CFBundleName</key><string>$APP_NAME</string>
  <key>CFBundleDisplayName</key><string>$APP_NAME</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>$VERSION</string>
  <key>CFBundleVersion</key><string>$VERSION</string>
  <key>LSMinimumSystemVersion</key><string>12.0</string>
  <key>LSUIElement</key><true/>
  <key>NSHighResolutionCapable</key><true/>
  <key>CFBundleIconFile</key><string>AETOS</string>
  <key>NSHumanReadableCopyright</key><string>AETOS Office Assistant</string>
</dict>
</plist>
EOF

# Embedded web assets
cp -R dist/. "$RESOURCES/web/"

# Menu bar icon
cp dist/assets/icon-32.png "$RESOURCES/menu-bar-icon.png"

# App icon (.icns) assembled from the PNG sizes
ICONSET="$BUILD_DIR/AETOS.iconset"
mkdir -p "$ICONSET"
cp dist/assets/icon-16.png "$ICONSET/icon_16x16.png"
cp dist/assets/icon-32.png "$ICONSET/icon_16x16@2x.png"
cp dist/assets/icon-32.png "$ICONSET/icon_32x32.png"
cp dist/assets/icon-64.png "$ICONSET/icon_32x32@2x.png"
cp dist/assets/icon-128.png "$ICONSET/icon_128x128.png"
cp dist/assets/icon-256.png "$ICONSET/icon_128x128@2x.png"
cp dist/assets/icon-256.png "$ICONSET/icon_256x256.png"
sips -z 512 512 dist/assets/icon-256.png --out "$ICONSET/icon_256x256@2x.png" >/dev/null
sips -z 512 512 dist/assets/icon-256.png --out "$ICONSET/icon_512x512.png" >/dev/null
sips -z 1024 1024 dist/assets/icon-256.png --out "$ICONSET/icon_512x512@2x.png" >/dev/null
iconutil -c icns "$ICONSET" -o "$RESOURCES/AETOS.icns"
rm -rf "$ICONSET"

# Code signing: Developer ID when configured, otherwise ad-hoc.
if [ -n "${AETOS_MAC_IDENTITY:-}" ]; then
  echo "Signing with Developer ID: $AETOS_MAC_IDENTITY"
  codesign --force --options runtime --timestamp --sign "$AETOS_MAC_IDENTITY" "$APP_DIR"
else
  echo "Ad-hoc signing (no AETOS_MAC_IDENTITY configured)"
  codesign --force --sign - "$APP_DIR"
fi

# Distributable zip (preserves the .app structure and executable bit)
ZIP="$BUILD_DIR/$BINARY_NAME-$VERSION-macos.zip"
rm -f "$ZIP"
COPYFILE_DISABLE=1 ditto -c -k --keepParent --norsrc --noextattr "$APP_DIR" "$ZIP"

# Notarization (optional). Requires Developer ID signing plus an Apple ID with
# an app-specific password. Stapling mutates the app, so the zip is recreated
# afterwards so the artifact carries the notarization ticket.
if [ -n "${AETOS_MAC_IDENTITY:-}" ] && [ -n "${AETOS_MAC_NOTARY_APPLE_ID:-}" ] && [ -n "${AETOS_MAC_NOTARY_TEAM_ID:-}" ] && [ -n "${AETOS_MAC_NOTARY_PASSWORD:-}" ]; then
  echo "Submitting for notarization..."
  xcrun notarytool submit "$ZIP" \
    --apple-id "$AETOS_MAC_NOTARY_APPLE_ID" \
    --team-id "$AETOS_MAC_NOTARY_TEAM_ID" \
    --password "$AETOS_MAC_NOTARY_PASSWORD" \
    --wait
  echo "Stapling notarization ticket..."
  xcrun stapler staple "$APP_DIR"
  rm -f "$ZIP"
  COPYFILE_DISABLE=1 ditto -c -k --keepParent --norsrc --noextattr "$APP_DIR" "$ZIP"
  echo "Notarized: $ZIP"
fi

echo "Built: $APP_DIR"
echo "Archive: $ZIP"

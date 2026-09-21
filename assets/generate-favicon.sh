#!/bin/sh
# BRIEF: Preserve the hand-drawn paper texture; crop to the potato mascot's sprout and face; omit the booth-name lettering for legibility at favicon sizes.
set -eu

SOURCE=${1:?"usage: generate-favicon.sh SOURCE_IMAGE [OUTPUT_DIR]"}
OUTPUT_DIR=${2:-"$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"}
WORK_FILE="${TMPDIR:-/tmp}/booth-favicon-$$.png"
trap 'rm -f "$WORK_FILE"' EXIT

cp "$SOURCE" "$WORK_FILE"
sips --cropToHeightWidth 650 650 --cropOffset 40 160 "$WORK_FILE" >/dev/null
sips --resampleHeightWidth 512 512 "$WORK_FILE" >/dev/null
cp "$WORK_FILE" "$OUTPUT_DIR/favicon.png"
sips --resampleHeightWidth 180 180 "$WORK_FILE" --out "$OUTPUT_DIR/apple-touch-icon.png" >/dev/null

#!/bin/bash
#
# Builds the site and syncs dist/ to an S3 bucket.
#
#   ./sync.sh s3://your-bucket-name
#
# Uses `aws s3 sync --delete`, so files removed from the site are removed from
# the bucket too. HTML is served with a short cache so a deploy is visible
# immediately; hashed assets are immutable and cached hard.

set -euo pipefail

DEST=${1:-}

if [ -z "$DEST" ]; then
	echo "Usage: $0 s3://your-bucket-name"
	exit 1
fi

[[ $DEST == s3://* ]] || DEST="s3://$DEST"

echo "[*] Regenerating plugin data and building..."
npm run build

echo "[*] Syncing hashed assets to $DEST"
aws s3 sync dist/ "$DEST" \
	--delete \
	--exclude "*.html" \
	--exclude "*.json" \
	--cache-control "public, max-age=31536000, immutable"

echo "[*] Syncing pages to $DEST"
aws s3 sync dist/ "$DEST" \
	--delete \
	--exclude "*" \
	--include "*.html" \
	--include "*.json" \
	--cache-control "public, max-age=300"

echo "[+] Done. Deployed $(find dist -name '*.html' | wc -l | tr -d ' ') pages."

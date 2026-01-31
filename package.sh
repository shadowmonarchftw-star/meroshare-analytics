#!/bin/bash

# Extract version from manifest.json
VERSION=$(grep '"version":' manifest.json | cut -d '"' -f 4)
FILENAME="meroshare-analytics-v$VERSION.zip"

echo "Packaging Meroshare Analytics v$VERSION..."

# Create a clean zip file
# Files and directories to include:
# - manifest.json
# - background.js
# - scripts/
# - styles/
# - assets/
# Note: We use -r for recursive and exclude hidden files

zip -r "$FILENAME" manifest.json background.js scripts/ styles/ assets/ -x "*.DS_Store*"

echo "Successfully created $FILENAME"
echo "You can now upload this file to the Firefox Add-on Developer Hub."

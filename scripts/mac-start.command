#!/bin/zsh
# Starts the AETOS Office Assistant HTTPS server in this Terminal window.
# Keep the window open while Word uses the add-in. Press Ctrl+C to stop it.
cd "$(dirname "$0")/.." || exit 1
exec npm start

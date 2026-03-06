#!/bin/bash
# Full cleanup: MiniCPM model, Ollama, and Snip saved data
# Run with: bash cleanup.sh

set -e

echo "=== 1. Remove MiniCPM-V model from Ollama ==="
if command -v ollama &>/dev/null; then
  ollama rm minicpm-v 2>/dev/null && echo "  Removed minicpm-v model" || echo "  minicpm-v model not found, skipping"
else
  echo "  ollama CLI not found, skipping model removal"
fi

echo ""
echo "=== 2. Remove Ollama ==="
# Stop any running Ollama processes
pkill -f ollama 2>/dev/null && echo "  Stopped Ollama processes" || echo "  No Ollama processes running"

# Remove Ollama app
if [ -d "/Applications/Ollama.app" ]; then
  rm -rf "/Applications/Ollama.app"
  echo "  Removed /Applications/Ollama.app"
else
  echo "  /Applications/Ollama.app not found"
fi

# Remove Ollama CLI binary
if [ -f "/usr/local/bin/ollama" ]; then
  rm -f "/usr/local/bin/ollama"
  echo "  Removed /usr/local/bin/ollama"
else
  echo "  /usr/local/bin/ollama not found"
fi

# Remove all Ollama data (models, manifests, etc.)
if [ -d "$HOME/.ollama" ]; then
  rm -rf "$HOME/.ollama"
  echo "  Removed ~/.ollama (all models and data)"
else
  echo "  ~/.ollama not found"
fi

echo ""
echo "=== 3. Remove Snip saved data ==="
# Screenshots and index
if [ -d "$HOME/Documents/snip" ]; then
  rm -rf "$HOME/Documents/snip"
  echo "  Removed ~/Documents/snip (screenshots, index, animations)"
else
  echo "  ~/Documents/snip not found"
fi

# Config and Electron app data
if [ -d "$HOME/Library/Application Support/snip" ]; then
  rm -rf "$HOME/Library/Application Support/snip"
  echo "  Removed ~/Library/Application Support/snip (config)"
else
  echo "  ~/Library/Application Support/snip not found"
fi

# Electron caches
if [ -d "$HOME/Library/Caches/snip" ]; then
  rm -rf "$HOME/Library/Caches/snip"
  echo "  Removed ~/Library/Caches/snip (cache)"
else
  echo "  ~/Library/Caches/snip not found"
fi

if [ -d "$HOME/Library/Logs/snip" ]; then
  rm -rf "$HOME/Library/Logs/snip"
  echo "  Removed ~/Library/Logs/snip (logs)"
else
  echo "  ~/Library/Logs/snip not found"
fi

echo ""
echo "Done. MiniCPM, Ollama, and Snip data have been removed."

#!/bin/bash
set -e

VPS_USER=vahalia
VPS_HOST=199.19.75.229
VPS_PATH=/var/www/apps

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

usage() {
  echo "Usage: $0 [app|home|all]"
  echo "  app   — build and deploy the great-circles app to /great-circles/"
  echo "  home  — deploy the apps home page"
  echo "  all   — both (default)"
  exit 1
}

deploy_app() {
  echo "→ Building app..."
  cd "$SCRIPT_DIR/Great-Circle"
  npm run build:vps
  echo "→ Deploying app to $VPS_HOST:$VPS_PATH/great-circles/..."
  rsync -avz --delete dist/ "$VPS_USER@$VPS_HOST:$VPS_PATH/great-circles/"
  echo "✓ App deployed"
}

deploy_home() {
  echo "→ Deploying home page to $VPS_HOST:$VPS_PATH/..."
  rsync -avz "$SCRIPT_DIR/apps-home/index.html" "$VPS_USER@$VPS_HOST:$VPS_PATH/"
  echo "✓ Home page deployed"
}

case "${1:-all}" in
  app)  deploy_app ;;
  home) deploy_home ;;
  all)  deploy_app && deploy_home ;;
  *)    usage ;;
esac

echo ""
echo "Live at https://apps.vahalia.com"

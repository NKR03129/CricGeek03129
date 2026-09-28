#!/usr/bin/env bash
# =============================================================================
# CricGeek — one-shot setup for macOS and Linux
#
# Run from the cricgeek-app folder:
#     bash scripts/setup.sh
#
# Checks your tools, installs dependencies, creates .env if missing, generates
# the database client, and applies the schema. Safe to run more than once.
# =============================================================================

set -uo pipefail

CYAN='\033[0;36m'; GREEN='\033[0;32m'; YELLOW='\033[0;33m'; RED='\033[0;31m'; NC='\033[0m'

step() { printf "\n${CYAN}==> %s${NC}\n" "$1"; }
ok()   { printf "    ${GREEN}OK   %s${NC}\n" "$1"; }
warn() { printf "    ${YELLOW}WARN %s${NC}\n" "$1"; }
fail() { printf "    ${RED}FAIL %s${NC}\n" "$1"; }

echo "CricGeek setup"
echo "=============="

# --- 1. Check Node.js --------------------------------------------------------
step "Checking Node.js"
if ! command -v node >/dev/null 2>&1; then
  fail "Node.js is not installed."
  echo "    Install the LTS version from https://nodejs.org then re-run this script."
  exit 1
fi

NODE_VERSION="$(node --version | sed 's/^v//')"
NODE_MAJOR="${NODE_VERSION%%.*}"
if [ "$NODE_MAJOR" -lt 20 ]; then
  fail "Node.js $NODE_VERSION found, but version 20 or newer is required."
  echo "    Install the LTS version from https://nodejs.org then re-run this script."
  exit 1
fi
ok "Node.js $NODE_VERSION"

# --- 2. Install dependencies -------------------------------------------------
step "Installing dependencies (this can take a few minutes)"
if ! npm install --no-audit --no-fund; then
  fail "npm install failed. Scroll up for the reason."
  exit 1
fi
ok "Dependencies installed"

# --- 3. Create .env ----------------------------------------------------------
step "Setting up environment variables"
if [ -f .env ]; then
  ok ".env already exists, leaving it untouched"
else
  cp .env.example .env
  ok "Created .env from .env.example"

  # Generate a session secret so sign-in works out of the box.
  SECRET="$(node -e "console.log(require('crypto').randomBytes(32).toString('base64'))")"
  # Use a different delimiter: a base64 secret can contain '/'.
  if sed --version >/dev/null 2>&1; then
    sed -i "s|AUTH_SECRET=\"\"|AUTH_SECRET=\"${SECRET}\"|" .env   # GNU sed
  else
    sed -i '' "s|AUTH_SECRET=\"\"|AUTH_SECRET=\"${SECRET}\"|" .env # BSD sed (macOS)
  fi
  ok "Generated AUTH_SECRET"

  warn "You still need to set DATABASE_URL in .env before the app will start."
fi

# --- 4. Generate the database client -----------------------------------------
step "Generating the database client"
if ! npx prisma generate; then
  warn "prisma generate failed."
  echo "    On a corporate network this is usually a TLS/proxy block on binaries.prisma.sh."
  echo "    Ask IT to allow that host, or set HTTPS_PROXY, then run: npx prisma generate"
else
  ok "Database client generated"
fi

# --- 5. Apply the schema -----------------------------------------------------
step "Applying the database schema"
if grep -q 'DATABASE_URL="[^"]*CHANGE_ME' .env 2>/dev/null; then
  warn "DATABASE_URL still has the placeholder password. Skipping schema setup."
  echo "    Edit .env, then run: npm run db:push"
elif ! npx prisma db push; then
  warn "prisma db push failed. Check DATABASE_URL in .env and that SQL Server is reachable."
else
  ok "Schema applied"
fi

# --- 6. Verify the scoring engine --------------------------------------------
step "Verifying the EQS scoring engine (offline, no keys needed)"
if npx tsx scripts/eqs-selftest.mts 2>&1 | tail -n 3; then
  ok "EQS self-test finished"
else
  warn "EQS self-test reported problems (see above)"
fi

# --- Done --------------------------------------------------------------------
echo ""
echo "============================================="
printf "${GREEN} Setup finished${NC}\n"
echo "============================================="
echo ""
echo " 1. Open .env and fill in DATABASE_URL (required)."
echo " 2. Optional but recommended: GEMINI_API_KEY, SPORTMONKS_API_TOKEN, DEEPGRAM_API_KEY."
echo " 3. Start the app:        npm run dev"
echo " 4. Open:                 http://localhost:3000"
echo " 5. Check what is wired:  http://localhost:3000/api/health"
echo ""

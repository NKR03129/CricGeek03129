# =============================================================================
# CricGeek — one-shot setup for Windows (PowerShell)
#
# Run from the cricgeek-app folder:
#     powershell -ExecutionPolicy Bypass -File scripts\setup.ps1
#
# Checks your tools, installs dependencies, creates .env if missing, generates
# the database client, and applies the schema. Safe to run more than once.
# =============================================================================

$ErrorActionPreference = "Stop"

function Write-Step  ($m) { Write-Host "`n==> $m" -ForegroundColor Cyan }
function Write-Ok    ($m) { Write-Host "    OK   $m" -ForegroundColor Green }
function Write-Warn2 ($m) { Write-Host "    WARN $m" -ForegroundColor Yellow }
function Write-Err2  ($m) { Write-Host "    FAIL $m" -ForegroundColor Red }

Write-Host "CricGeek setup" -ForegroundColor White
Write-Host "==============" -ForegroundColor White

# --- 1. Check Node.js ---------------------------------------------------------
Write-Step "Checking Node.js"
$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) {
    Write-Err2 "Node.js is not installed."
    Write-Host "    Install the LTS version from https://nodejs.org then re-run this script."
    exit 1
}

$nodeVersion = (& node --version).TrimStart("v")
$nodeMajor = [int]($nodeVersion.Split(".")[0])
if ($nodeMajor -lt 20) {
    Write-Err2 "Node.js $nodeVersion found, but version 20 or newer is required."
    Write-Host "    Install the LTS version from https://nodejs.org then re-run this script."
    exit 1
}
Write-Ok "Node.js $nodeVersion"

# --- 2. Install dependencies -------------------------------------------------
Write-Step "Installing dependencies (this can take a few minutes)"
& npm install --no-audit --no-fund
if ($LASTEXITCODE -ne 0) {
    Write-Err2 "npm install failed. Scroll up for the reason."
    exit 1
}
Write-Ok "Dependencies installed"

# --- 3. Create .env ----------------------------------------------------------
Write-Step "Setting up environment variables"
if (Test-Path ".env") {
    Write-Ok ".env already exists, leaving it untouched"
} else {
    Copy-Item ".env.example" ".env"
    Write-Ok "Created .env from .env.example"

    # Generate a session secret so sign-in works out of the box.
    $secret = & node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
    $content = Get-Content ".env" -Raw
    $content = $content -replace 'AUTH_SECRET=""', ('AUTH_SECRET="' + $secret + '"')
    Set-Content ".env" $content -Encoding utf8 -NoNewline
    Write-Ok "Generated AUTH_SECRET"

    Write-Warn2 "You still need to set DATABASE_URL in .env before the app will start."
}

# --- 4. Generate the database client -----------------------------------------
Write-Step "Generating the database client"
& npx prisma generate
if ($LASTEXITCODE -ne 0) {
    Write-Warn2 "prisma generate failed."
    Write-Host "    On a corporate network this is usually a TLS/proxy block on binaries.prisma.sh."
    Write-Host "    Ask IT to allow that host, or set HTTPS_PROXY, then run: npx prisma generate"
} else {
    Write-Ok "Database client generated"
}

# --- 5. Apply the schema -----------------------------------------------------
Write-Step "Applying the database schema"
$envText = Get-Content ".env" -Raw -ErrorAction SilentlyContinue
if ($envText -match 'DATABASE_URL="[^"]*CHANGE_ME') {
    Write-Warn2 "DATABASE_URL still has the placeholder password. Skipping schema setup."
    Write-Host "    Edit .env, then run: npm run db:push"
} else {
    & npx prisma db push
    if ($LASTEXITCODE -ne 0) {
        Write-Warn2 "prisma db push failed. Check DATABASE_URL in .env and that SQL Server is reachable."
    } else {
        Write-Ok "Schema applied"
    }
}

# --- 6. Verify the scoring engine --------------------------------------------
Write-Step "Verifying the EQS scoring engine (offline, no keys needed)"
& npx tsx scripts/eqs-selftest.mts *>&1 | Select-Object -Last 3
if ($LASTEXITCODE -eq 0) { Write-Ok "EQS self-test passed" } else { Write-Warn2 "EQS self-test reported problems (see above)" }

# --- Done --------------------------------------------------------------------
Write-Host "`n=============================================" -ForegroundColor White
Write-Host " Setup finished" -ForegroundColor Green
Write-Host "=============================================" -ForegroundColor White
Write-Host ""
Write-Host " 1. Open .env and fill in DATABASE_URL (required)."
Write-Host " 2. Optional but recommended: GEMINI_API_KEY, SPORTMONKS_API_TOKEN, DEEPGRAM_API_KEY."
Write-Host " 3. Start the app:        npm run dev"
Write-Host " 4. Open:                 http://localhost:3000"
Write-Host " 5. Check what is wired:  http://localhost:3000/api/health"
Write-Host ""

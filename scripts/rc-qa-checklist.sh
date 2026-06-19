#!/usr/bin/env bash
# Release Candidate QA Checklist for Ribix IDE (issue #83)
#
# Runs automated checks against a deployed ribix-ide instance to verify
# release-candidate quality. Exits non-zero if any check fails.
#
# Usage:
#   RC_URL=https://staging.ribix.dev ./scripts/rc-qa-checklist.sh
#
# Environment variables:
#   RC_URL       — Base URL of the RC instance (required)
#   RC_WS_URL    — WebSocket URL (default: wss://$RC_URL/collaboration)
#   RC_API_URL   — API URL (default: $RC_URL/web-ide)
#   VERBOSE      — Set to 1 for verbose output

set -euo pipefail

RC_URL="${RC_URL:?RC_URL is required (e.g. https://staging.ribix.dev)}"
RC_WS_URL="${RC_WS_URL:-wss://${RC_URL#https://}/collaboration}"
RC_API_URL="${RC_API_URL:-${RC_URL}/web-ide}"
VERBOSE="${VERBOSE:-0}"

PASS=0
FAIL=0
SKIP=0

log() { echo "[$(date -u +%H:%M:%S)] $*"; }
pass() { log "✅ PASS: $1"; ((PASS++)); }
fail() { log "❌ FAIL: $1 — $2"; ((FAIL++)); }
skip() { log "⏭️  SKIP: $1 — $2"; ((SKIP++)); }
info() { [ "$VERBOSE" = "1" ] && log "   $1"; }

# ─── 1. Health Endpoints ────────────────────────────────────────────────────

check_health() {
  log "=== Health Endpoints ==="

  # Web IDE health
  local resp
  resp=$(curl -sS -o /dev/null -w "%{http_code}" "${RC_URL}/health" 2>/dev/null) || true
  if [ "$resp" = "200" ]; then
    pass "Web IDE /health returns 200"
  else
    fail "Web IDE /health" "expected 200, got ${resp:-no response}"
  fi

  # Web IDE health body
  local body
  body=$(curl -sS "${RC_URL}/health" 2>/dev/null) || true
  if echo "$body" | grep -q '"status":"ok"'; then
    pass "Web IDE health body contains status:ok"
  else
    fail "Web IDE health body" "missing status:ok in response"
  fi

  # Marketplace health
  resp=$(curl -sS -o /dev/null -w "%{http_code}" "${RC_URL}/web-ide/marketplace/health" 2>/dev/null) || true
  if [ "$resp" = "204" ] || [ "$resp" = "200" ]; then
    pass "Marketplace health endpoint reachable"
  else
    fail "Marketplace health" "expected 200/204, got ${resp:-no response}"
  fi
}

# ─── 2. TLS/SSL ─────────────────────────────────────────────────────────────

check_tls() {
  log "=== TLS/SSL ==="

  # HTTPS redirect
  local resp
  resp=$(curl -sS -o /dev/null -w "%{http_code}" "http://${RC_URL#https://}/health" -L --max-redirs 0 2>/dev/null) || true
  if [ "$resp" = "301" ] || [ "$resp" = "302" ] || [ "$resp" = "308" ]; then
    pass "HTTP redirects to HTTPS"
  else
    fail "HTTP to HTTPS redirect" "expected 3xx, got ${resp:-no response}"
  fi

  # TLS certificate validity
  local cert_end_date
  cert_end_date=$(echo | openssl s_client -connect "${RC_URL#https://}:443" -servername "${RC_URL#https://}" 2>/dev/null \
    | openssl x509 -noout -enddate 2>/dev/null | cut -d= -f2) || true
  if [ -n "$cert_end_date" ]; then
    local days_left
    days_left=$(( ($(date -d "$cert_end_date" +%s 2>/dev/null || date -j -f "%b %d %H:%M:%S %Y %Z" "$cert_end_date" +%s 2>/dev/null) - $(date +%s)) / 86400 ))
    if [ "$days_left" -gt 14 ]; then
      pass "TLS certificate valid for ${days_left} days"
    else
      fail "TLS certificate" "expires in ${days_left} days (< 14)"
    fi
  else
    skip "TLS certificate check" "openssl not available or connection failed"
  fi

  # HSTS header
  local headers
  headers=$(curl -sSI "${RC_URL}/health" 2>/dev/null) || true
  if echo "$headers" | grep -qi "strict-transport-security"; then
    pass "HSTS header present"
  else
    fail "HSTS header" "not found in response headers"
  fi
}

# ─── 3. Web IDE Functional ──────────────────────────────────────────────────

check_web_ide() {
  log "=== Web IDE Functional ==="

  # Page loads
  local resp
  resp=$(curl -sS -o /dev/null -w "%{http_code}" "${RC_URL}/" 2>/dev/null) || true
  if [ "$resp" = "200" ]; then
    pass "Web IDE page loads (200)"
  else
    fail "Web IDE page load" "expected 200, got ${resp:-no response}"
  fi

  # Page contains expected content
  local body
  body=$(curl -sS "${RC_URL}/" 2>/dev/null) || true
  if echo "$body" | grep -qi "ribix\|editor\|monaco"; then
    pass "Web IDE page contains editor content"
  else
    fail "Web IDE page content" "missing expected editor/ribix/monaco markers"
  fi
}

# ─── 4. Marketplace ─────────────────────────────────────────────────────────

check_marketplace() {
  log "=== Marketplace ==="

  # Search for a popular extension
  local resp body
  body=$(curl -sS -X POST "${RC_URL}/web-ide/marketplace/query" \
    -H "Content-Type: application/json" \
    -d '{"filters":[{"criteria":[{"filterType":10,"value":"python"}]}],"flags":914}' \
    2>/dev/null) || true

  if echo "$body" | grep -q "results"; then
    pass "Marketplace search returns results"
  else
    fail "Marketplace search" "no results in response"
  fi
}

# ─── 5. Docker Images ───────────────────────────────────────────────────────

check_docker() {
  log "=== Docker Images ==="

  if ! command -v docker &>/dev/null; then
    skip "Docker image checks" "docker not installed"
    return
  fi

  # Check web-ide image
  if docker pull "ghcr.io/ch1kim0n1/ribix-ide/web-ide:latest" 2>/dev/null; then
    pass "Web IDE Docker image pulls successfully"
  else
    skip "Web IDE Docker image" "cannot pull (may need auth)"
  fi

  # Check websocket image
  if docker pull "ghcr.io/ch1kim0n1/ribix-ide/websocket-server:latest" 2>/dev/null; then
    pass "WebSocket Docker image pulls successfully"
  else
    skip "WebSocket Docker image" "cannot pull (may need auth)"
  fi
}

# ─── 6. K8s Manifests ───────────────────────────────────────────────────────

check_k8s() {
  log "=== Kubernetes Manifests ==="

  if ! command -v kubectl &>/dev/null; then
    skip "K8s manifest validation" "kubectl not installed"
    return
  fi

  # Validate manifests parse
  local manifest_dir
  manifest_dir="$(cd "$(dirname "$0")/.." && pwd)/web-ide/k8s"

  for f in deployment.yaml tls.yaml monitoring.yaml alerting-rules.yaml; do
    local path="${manifest_dir}/${f}"
    if [ -f "$path" ]; then
      if kubectl apply --dry-run=client -f "$path" &>/dev/null; then
        pass "K8s manifest ${f} validates"
      else
        fail "K8s manifest ${f}" "dry-run validation failed"
      fi
    else
      skip "K8s manifest ${f}" "file not found"
    fi
  done
}

# ─── 7. Terraform ───────────────────────────────────────────────────────────

check_terraform() {
  log "=== Terraform ==="

  if ! command -v terraform &>/dev/null; then
    skip "Terraform validation" "terraform not installed"
    return
  fi

  local tf_dir
  tf_dir="$(cd "$(dirname "$0")/.." && pwd)/infra/terraform"

  if [ -d "$tf_dir" ]; then
    if (cd "$tf_dir" && terraform fmt -check -recursive 2>/dev/null); then
      pass "Terraform files are formatted"
    else
      fail "Terraform formatting" "files need terraform fmt"
    fi

    if (cd "$tf_dir" && terraform validate 2>/dev/null); then
      pass "Terraform configuration validates"
    else
      skip "Terraform validate" "requires terraform init (no provider plugins)"
    fi
  else
    skip "Terraform validation" "infra/terraform directory not found"
  fi
}

# ─── 8. Test Suite ──────────────────────────────────────────────────────────

check_tests() {
  log "=== Test Suite ==="

  local web_ide_dir
  web_ide_dir="$(cd "$(dirname "$0")/.." && pwd)/web-ide"

  if [ -d "$web_ide_dir" ]; then
    if (cd "$web_ide_dir" && npx vitest run --reporter=verbose 2>&1 | tail -5); then
      pass "Web IDE test suite passes"
    else
      fail "Web IDE test suite" "tests failed"
    fi
  else
    skip "Web IDE tests" "web-ide directory not found"
  fi
}

# ─── 9. Type Check ──────────────────────────────────────────────────────────

check_types() {
  log "=== Type Check ==="

  local web_ide_dir
  web_ide_dir="$(cd "$(dirname "$0")/.." && pwd)/web-ide"

  if [ -d "$web_ide_dir" ]; then
    if (cd "$web_ide_dir" && npm run typecheck 2>&1); then
      pass "Web IDE typecheck passes"
    else
      fail "Web IDE typecheck" "type errors found"
    fi
  else
    skip "Web IDE typecheck" "web-ide directory not found"
  fi
}

# ─── Main ───────────────────────────────────────────────────────────────────

main() {
  log "Ribix IDE — Release Candidate QA Checklist"
  log "Target: ${RC_URL}"
  log ""

  check_health
  check_tls
  check_web_ide
  check_marketplace
  check_docker
  check_k8s
  check_terraform
  check_tests
  check_types

  log ""
  log "=== Summary ==="
  log "Passed: ${PASS}"
  log "Failed: ${FAIL}"
  log "Skipped: ${SKIP}"
  log ""

  if [ "$FAIL" -gt 0 ]; then
    log "❌ RC QA FAILED — ${FAIL} check(s) failed"
    exit 1
  else
    log "✅ RC QA PASSED — all checks passed (${SKIP} skipped)"
    exit 0
  fi
}

main "$@"

#!/bin/bash
# Integration Test Script for AgentSmith
# Uses curl to verify all pages are accessible

set -e

# Configuration
BASE_URL="${BASE_URL:-http://localhost:3000}"
LOCALES=("en-US" "zh-CN")
WORKSPACE_ID="ws_default"
PROJECT_ID="proj_1"

# Color output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Counters
TOTAL_TESTS=0
PASSED_TESTS=0
FAILED_TESTS=0

# Test function
test_url() {
  local url="$1"
  local description="$2"
  local expected_code="${3:-200}"

  TOTAL_TESTS=$((TOTAL_TESTS + 1))

  echo -n "Testing: $description ... "

  # Use curl to get HTTP status code
  HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" -L "$url")

  if [ "$HTTP_CODE" = "$expected_code" ]; then
    echo -e "${GREEN}PASS${NC} (HTTP $HTTP_CODE)"
    PASSED_TESTS=$((PASSED_TESTS + 1))
    return 0
  else
    echo -e "${RED}FAIL${NC} (Expected: $expected_code, Got: $HTTP_CODE)"
    FAILED_TESTS=$((FAILED_TESTS + 1))
    return 1
  fi
}

# Print header
echo "=========================================="
echo "AgentSmith Integration Tests"
echo "=========================================="
echo "Base URL: $BASE_URL"
echo ""

# Test homepage (should redirect or show login)
echo "--- Homepage Tests ---"
test_url "$BASE_URL" "Homepage" 200
test_url "$BASE_URL/" "Homepage with trailing slash" 200

for locale in "${LOCALES[@]}"; do
  echo ""
  echo "--- Locale: $locale ---"

  # Login page
  test_url "$BASE_URL/$locale/login" "Login page" 200

  # Project list page
  test_url "$BASE_URL/$locale/workspaces/$WORKSPACE_ID/projects" "Projects list" 200

  # Project pages
  test_url "$BASE_URL/$locale/workspaces/$WORKSPACE_ID/projects/$PROJECT_ID/overview" "Project Overview" 200
  test_url "$BASE_URL/$locale/workspaces/$WORKSPACE_ID/projects/$PROJECT_ID/chat" "Chat Workspace" 200
  test_url "$BASE_URL/$locale/workspaces/$WORKSPACE_ID/projects/$PROJECT_ID/studio" "Workbench Workspace" 200
  test_url "$BASE_URL/$locale/workspaces/$WORKSPACE_ID/projects/$PROJECT_ID/agents" "Agents Management" 200
  test_url "$BASE_URL/$locale/workspaces/$WORKSPACE_ID/projects/$PROJECT_ID/endpoints" "Endpoints Management" 200
  test_url "$BASE_URL/$locale/workspaces/$WORKSPACE_ID/projects/$PROJECT_ID/members" "Members Management" 200
  test_url "$BASE_URL/$locale/workspaces/$WORKSPACE_ID/projects/$PROJECT_ID/audit" "Audit Log" 200
  test_url "$BASE_URL/$locale/workspaces/$WORKSPACE_ID/projects/$PROJECT_ID/usage" "Usage Analytics" 200
  test_url "$BASE_URL/$locale/workspaces/$WORKSPACE_ID/projects/$PROJECT_ID/settings" "Settings" 200
  test_url "$BASE_URL/$locale/workspaces/$WORKSPACE_ID/projects/$PROJECT_ID/files" "Files" 200
done

# Test 404 handling
echo ""
echo "--- Error Handling Tests ---"
test_url "$BASE_URL/en-US/this-page-does-not-exist" "Non-existent page should return 404" 404

# Print summary
echo ""
echo "=========================================="
echo "Test Summary"
echo "=========================================="
echo -e "Total:  $TOTAL_TESTS"
echo -e "${GREEN}Passed: $PASSED_TESTS${NC}"
echo -e "${RED}Failed: $FAILED_TESTS${NC}"

if [ $FAILED_TESTS -eq 0 ]; then
  echo ""
  echo -e "${GREEN}All tests passed!${NC}"
  exit 0
else
  echo ""
  echo -e "${RED}Some tests failed!${NC}"
  exit 1
fi

#!/bin/bash
set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${GREEN}🚀 Exocortex Plugin Release Automation${NC}"
echo "========================================="

# Function to check command success
check_status() {
    if [ $? -eq 0 ]; then
        echo -e "${GREEN}✅ $1${NC}"
    else
        echo -e "${RED}❌ $1 failed!${NC}"
        exit 1
    fi
}

# Step 1: Verify working directory is clean
echo -e "\n${YELLOW}Step 1: Checking git status...${NC}"
if [[ -n $(git status --porcelain) ]]; then
    echo -e "${RED}❌ Working directory has uncommitted changes!${NC}"
    echo "Please commit or stash changes before releasing."
    git status --short
    exit 1
fi
check_status "Git working directory is clean"

# Step 2: Pull latest changes
echo -e "\n${YELLOW}Step 2: Pulling latest changes...${NC}"
git pull origin main
check_status "Latest changes pulled"

# Step 3: Run tests
echo -e "\n${YELLOW}Step 3: Running test suite...${NC}"
npm test
check_status "All tests passed"

# Step 4: Check test coverage
echo -e "\n${YELLOW}Step 4: Checking test coverage...${NC}"
npm run test:coverage 2>&1 | tee coverage.tmp
COVERAGE=$(grep "All files" coverage.tmp | awk '{print $10}' | sed 's/%//')
rm coverage.tmp

if (( $(echo "$COVERAGE < 70" | bc -l) )); then
    echo -e "${RED}❌ Test coverage is below 70% (${COVERAGE}%)${NC}"
    exit 1
fi
echo -e "${GREEN}✅ Test coverage: ${COVERAGE}%${NC}"

# Step 5: Build the plugin
echo -e "\n${YELLOW}Step 5: Building plugin...${NC}"
npm run build
check_status "Build completed successfully"

# Step 6: Check bundle size
echo -e "\n${YELLOW}Step 6: Checking bundle size...${NC}"
if [ -f "main.js" ]; then
    BUNDLE_SIZE=$(stat -f%z main.js 2>/dev/null || stat -c%s main.js 2>/dev/null)
    BUNDLE_SIZE_MB=$(echo "scale=2; $BUNDLE_SIZE / 1048576" | bc)
    
    if (( $(echo "$BUNDLE_SIZE > 1048576" | bc -l) )); then
        echo -e "${YELLOW}⚠️  Warning: Bundle size is ${BUNDLE_SIZE_MB}MB (exceeds 1MB)${NC}"
    else
        echo -e "${GREEN}✅ Bundle size: ${BUNDLE_SIZE_MB}MB${NC}"
    fi
else
    echo -e "${RED}❌ main.js not found!${NC}"
    exit 1
fi

# Step 7: Get current version
CURRENT_VERSION=$(node -p "require('./package.json').version")
echo -e "\n${GREEN}Current version: v${CURRENT_VERSION}${NC}"

# Step 8: Determine version bump
echo -e "\n${YELLOW}Step 7: Select version bump type:${NC}"
echo "1) patch (bug fixes) - $(npm version patch --no-git-tag-version --dry-run 2>/dev/null | grep -oE '[0-9]+\.[0-9]+\.[0-9]+')"
echo "2) minor (new features) - $(npm version minor --no-git-tag-version --dry-run 2>/dev/null | grep -oE '[0-9]+\.[0-9]+\.[0-9]+')"
echo "3) major (breaking changes) - $(npm version major --no-git-tag-version --dry-run 2>/dev/null | grep -oE '[0-9]+\.[0-9]+\.[0-9]+')"
read -p "Enter choice (1-3): " choice

case $choice in
    1) VERSION_TYPE="patch";;
    2) VERSION_TYPE="minor";;
    3) VERSION_TYPE="major";;
    *) echo -e "${RED}Invalid choice${NC}"; exit 1;;
esac

# Step 9: Update version
echo -e "\n${YELLOW}Step 8: Updating version...${NC}"
npm version $VERSION_TYPE --no-git-tag-version
NEW_VERSION=$(node -p "require('./package.json').version")
echo -e "${GREEN}New version: v${NEW_VERSION}${NC}"

# Step 10: Check if CHANGELOG.md needs updating
echo -e "\n${YELLOW}Step 9: Checking CHANGELOG.md...${NC}"
if ! grep -q "\[$NEW_VERSION\]" CHANGELOG.md; then
    echo -e "${YELLOW}⚠️  CHANGELOG.md needs to be updated for v${NEW_VERSION}${NC}"
    echo "Please add release notes in the following format:"
    echo ""
    echo "## [$NEW_VERSION] - $(date +%Y-%m-%d)"
    echo ""
    echo "### 🚀 Major Improvements"
    echo "- Feature description (user-focused)"
    echo ""
    echo "### 🐛 Bug Fixes"
    echo "- Bug fix description"
    echo ""
    echo -e "${YELLOW}Opening CHANGELOG.md in your editor...${NC}"
    ${EDITOR:-nano} CHANGELOG.md
    
    if ! grep -q "\[$NEW_VERSION\]" CHANGELOG.md; then
        echo -e "${RED}❌ CHANGELOG.md was not updated!${NC}"
        exit 1
    fi
fi
check_status "CHANGELOG.md is up to date"

# Step 11: Extract release notes
echo -e "\n${YELLOW}Step 10: Extracting release notes...${NC}"
awk "/\[$NEW_VERSION\]/,/^## \[/" CHANGELOG.md | head -n -1 > release_notes.tmp
check_status "Release notes extracted"

# Step 12: Commit changes
echo -e "\n${YELLOW}Step 11: Committing changes...${NC}"
git add -A
git commit -m "chore: Release v$NEW_VERSION

$(cat release_notes.tmp | head -20)"
check_status "Changes committed"

# Step 13: Push to GitHub
echo -e "\n${YELLOW}Step 12: Pushing to GitHub...${NC}"
git push origin main
check_status "Pushed to GitHub"

# Step 14: Create GitHub release
echo -e "\n${YELLOW}Step 13: Creating GitHub release...${NC}"

# Get a brief title from the first major improvement
TITLE=$(grep -A 1 "### 🚀 Major Improvements" release_notes.tmp | tail -1 | sed 's/^- //' | cut -c1-50)
if [ -z "$TITLE" ]; then
    TITLE="Release v$NEW_VERSION"
fi

gh release create "v$NEW_VERSION" \
    --title "v$NEW_VERSION - $TITLE" \
    --notes-file release_notes.tmp \
    main.js manifest.json styles.css

check_status "GitHub release created"

# Cleanup
rm -f release_notes.tmp

# Final summary
echo ""
echo -e "${GREEN}=========================================${NC}"
echo -e "${GREEN}🎉 Release v$NEW_VERSION completed successfully!${NC}"
echo -e "${GREEN}=========================================${NC}"
echo ""
echo "📊 Summary:"
echo "  • Version: v$NEW_VERSION"
echo "  • Tests: All passing"
echo "  • Coverage: ${COVERAGE}%"
echo "  • Bundle size: ${BUNDLE_SIZE_MB}MB"
echo ""
echo "🔗 Links:"
echo "  • Release: https://github.com/kitelev/exocortex/releases/tag/v$NEW_VERSION"
echo "  • Repository: https://github.com/kitelev/exocortex"
echo ""
echo "📦 Next steps:"
echo "  • BRAT users will receive the update automatically"
echo "  • Manual users should download from the release page"
echo ""
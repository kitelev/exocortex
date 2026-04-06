# E2E Testing Locally with Docker

## ⚠️ CRITICAL SAFETY RULE

**NEVER run E2E tests directly on your machine!**

```bash
# ❌ WRONG - DO NOT RUN THIS!
npm run test:e2e

# ✅ CORRECT - Always use Docker
npm run test:e2e:docker
```

**Why?** E2E tests launch a real Obsidian instance. Running directly on your machine can:
- Interfere with your production Obsidian vault
- Leave background processes running
- Cause conflicts with your working environment

## ✅ Safe Local Testing (Docker Only)

### Method 1: Using npm script (Recommended)

```bash
# Build Docker image and run E2E tests in isolated container
npm run test:e2e:docker
```

This command:
1. Builds the Docker image with Obsidian + plugin
2. Runs tests inside the container with xvfb (headless display)
3. Cleans up automatically when done

### Method 2: Manual Docker commands

```bash
# Step 1: Build the E2E Docker image (specify platform for ARM Macs)
docker build --platform linux/amd64 -f Dockerfile.e2e -t exocortex-e2e .

# Step 2: Run E2E tests in the container
docker run --rm exocortex-e2e npm run test:e2e

# Optional: Run with interactive shell for debugging
docker run --rm -it exocortex-e2e /bin/bash
```

### Method 3: Docker with volume mount (for iterating on tests)

```bash
# Build image once (specify platform for ARM Macs)
docker build --platform linux/amd64 -f Dockerfile.e2e -t exocortex-e2e .

# Run tests with current test code mounted
docker run --rm \
  -v $(pwd)/tests/e2e:/app/tests/e2e:ro \
  exocortex-e2e npm run test:e2e
```

## 🐛 Debugging Failed Tests

### View test report after failure

E2E tests generate HTML reports even on failure:

```bash
# After running tests, open the report
open playwright-report-e2e/index.html
```

### Run specific test

```bash
# Build image
docker build -f Dockerfile.e2e -t exocortex-e2e .

# Run specific test file
docker run --rm exocortex-e2e \
  npx playwright test tests/e2e/specs/daily-note-tasks.spec.ts

# Run specific test by name
docker run --rm exocortex-e2e \
  npx playwright test -g "should display only tasks for the current day"
```

### Interactive debugging

```bash
# Start container with shell
docker run --rm -it exocortex-e2e /bin/bash

# Inside container, you can:
ls -la tests/e2e/test-vault/           # Check test vault
cat tests/e2e/test-vault/Daily\ Notes/2025-10-16.md  # View fixtures
npm run test:e2e                        # Run tests
npx playwright test --debug             # Debug mode (requires X11 forwarding)
```

### Enable verbose logging

```bash
docker run --rm \
  -e DEBUG=pw:api \
  exocortex-e2e npm run test:e2e
```

## 📊 Understanding Test Output

### Successful run

```
Running 3 tests using 1 worker

  ✓  1 [e2e] › daily-note-tasks.spec.ts:18:7 › should display only tasks (2.5s)
  ✓  2 [e2e] › daily-note-tasks.spec.ts:41:7 › should display task status (1.8s)
  ✓  3 [e2e] › daily-note-tasks.spec.ts:60:7 › should filter archived tasks (1.2s)

  3 passed (6.1s)
```

### Failed run

```
Running 3 tests using 1 worker

  ✘  1 [e2e] › daily-note-tasks.spec.ts:18:7 › should display only tasks (550ms)

    Error: Timeout 30000ms exceeded waiting for selector '.exocortex-layout-container'
```

Check the HTML report for screenshots and detailed error traces.

## 🚀 Performance Tips

### Use Docker layer cache

Docker will cache layers between runs. The first run is slow (~8-10 min), but subsequent runs are fast (~2-3 min):

```bash
# First run - downloads Obsidian, installs deps
npm run test:e2e:docker  # ~8-10 minutes

# Subsequent runs - uses cached layers
npm run test:e2e:docker  # ~2-3 minutes
```

### Rebuild only when needed

Docker automatically detects changes. But you can force rebuild:

```bash
# Force rebuild (discards cache)
docker build --no-cache -f Dockerfile.e2e -t exocortex-e2e .
```

### Clear old Docker images

```bash
# Remove old E2E images
docker rmi exocortex-e2e

# Prune all unused images
docker image prune -a
```

## 📝 Test Vault Structure

The test vault is isolated and includes fixtures:

```
packages/obsidian-plugin/tests/e2e/test-vault/
├── .obsidian/
│   ├── app.json                    # Obsidian config
│   └── plugins/
│       └── exocortex/
│           ├── main.js             # Your plugin (built from packages/obsidian-plugin)
│           └── manifest.json
├── Daily Notes/
│   └── 2025-10-16.md              # Test DailyNote
└── Tasks/
    ├── morning-standup.md          # Task for 2025-10-16
    ├── code-review.md              # Task for 2025-10-16
    └── different-day-task.md       # Task for different day (control)
```

## 🔧 Troubleshooting

### "Docker not found"

Install Docker Desktop: https://www.docker.com/products/docker-desktop/

### "Cannot connect to Docker daemon"

Start Docker Desktop application.

### "Exec format error" on ARM Macs (M1/M2/M3)

**IMPORTANT**: E2E tests currently have technical limitations on ARM Macs (M1/M2/M3) due to Playwright + Electron compatibility issues. The Docker infrastructure works correctly on x86_64 systems (GitHub Actions CI runners).

**For ARM Mac users:**
- E2E tests are designed to run in CI on x86_64 runners
- Local execution on ARM Mac may timeout during Playwright connection to Obsidian
- This is a known Playwright limitation, not a bug in the plugin

**For x86_64 systems (CI):**
The Docker image uses tar.gz archives with architecture detection and runs successfully on x86_64 Linux systems.

### Tests timeout in Docker

If tests timeout on x86_64 systems, increase timeout in `playwright-e2e.config.ts`:

```typescript
timeout: 120000, // 2 minutes instead of 60s
```

### "No such file or directory: main.js"

Plugin not built. Run:

```bash
npm run build
```

Then rebuild Docker image.

### Tests pass in CI but fail locally

Check Docker version and available memory:

```bash
docker version
docker info | grep Memory
```

Ensure Docker has at least 4GB RAM allocated.

## 📚 Related Documentation

- [TESTING.md](.github/TESTING.md) - Full testing guide
- [Playwright E2E docs](https://playwright.dev/docs/intro)

## 🎯 Quick Reference

```bash
# Run E2E tests (always use Docker)
npm run test:e2e:docker

# View test report
open playwright-report-e2e/index.html

# Debug specific test
docker run --rm exocortex-e2e \
  npx playwright test -g "test name"

# Clean Docker cache
docker system prune -a
```

**Remember:** Always use Docker for E2E tests! Never run `npm run test:e2e` directly on your machine.

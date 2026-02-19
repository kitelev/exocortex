# CLI Integration Examples

Real-world examples of integrating Exocortex CLI with CI/CD pipelines, external tools, and automated workflows.

## Table of Contents

- [GitHub Actions](#github-actions)
- [GitLab CI/CD](#gitlab-cicd)
- [Automated Task Creation](#automated-task-creation)
- [External Tool Integration](#external-tool-integration)
- [Webhook Automation](#webhook-automation)
- [Scheduled Maintenance](#scheduled-maintenance)

---

## GitHub Actions

### Auto-Create Issues as Tasks

Automatically create Exocortex tasks when GitHub issues are opened.

**.github/workflows/issue-to-task.yml:**
```yaml
name: Create Task from Issue

on:
  issues:
    types: [opened]

jobs:
  create-task:
    runs-on: ubuntu-latest

    steps:
      - name: Checkout vault
        uses: actions/checkout@v3
        with:
          repository: username/my-vault
          token: ${{ secrets.VAULT_TOKEN }}
          path: vault

      - name: Setup Node.js
        uses: actions/setup-node@v3
        with:
          node-version: '18'

      - name: Install Exocortex CLI
        run: npm install -g @kitelev/exocortex-cli

      - name: Create task from issue
        env:
          ISSUE_TITLE: ${{ github.event.issue.title }}
          ISSUE_NUMBER: ${{ github.event.issue.number }}
          ISSUE_URL: ${{ github.event.issue.html_url }}
        run: |
          # Generate task filename
          TASK_FILE="03 Knowledge/tasks/github-issue-${ISSUE_NUMBER}.md"

          # Create task
          exocortex command create-task "$TASK_FILE" \
            --label "GitHub Issue #${ISSUE_NUMBER}: ${ISSUE_TITLE}" \
            --vault vault

          # Add issue URL to task body
          echo "" >> "vault/$TASK_FILE"
          echo "## GitHub Issue" >> "vault/$TASK_FILE"
          echo "" >> "vault/$TASK_FILE"
          echo "- Issue: #${ISSUE_NUMBER}" >> "vault/$TASK_FILE"
          echo "- URL: ${ISSUE_URL}" >> "vault/$TASK_FILE"

      - name: Commit and push
        working-directory: vault
        run: |
          git config user.name "GitHub Actions"
          git config user.email "actions@github.com"
          git add .
          git commit -m "Create task from issue #${ISSUE_NUMBER}"
          git push
```

---

### Complete Tasks from PR Merge

Automatically complete tasks when PRs are merged.

**.github/workflows/pr-complete-task.yml:**
```yaml
name: Complete Task on PR Merge

on:
  pull_request:
    types: [closed]

jobs:
  complete-task:
    if: github.event.pull_request.merged == true
    runs-on: ubuntu-latest

    steps:
      - name: Checkout vault
        uses: actions/checkout@v3
        with:
          repository: username/my-vault
          token: ${{ secrets.VAULT_TOKEN }}
          path: vault

      - name: Install Exocortex CLI
        run: npm install -g @kitelev/exocortex-cli

      - name: Extract task UID from PR
        id: extract
        env:
          PR_BODY: ${{ github.event.pull_request.body }}
        run: |
          # Extract UID from PR body (format: "Task: [[task-uid]]")
          TASK_UID=$(echo "$PR_BODY" | grep -oP 'Task: \[\[\K[^\]]+')

          if [ -n "$TASK_UID" ]; then
            echo "task_uid=$TASK_UID" >> $GITHUB_OUTPUT
          fi

      - name: Complete task
        if: steps.extract.outputs.task_uid != ''
        run: |
          TASK_UID="${{ steps.extract.outputs.task_uid }}"
          TASK_FILE=$(find vault -name "${TASK_UID}.md" | head -1)

          if [ -n "$TASK_FILE" ]; then
            # Get relative path
            RELATIVE_PATH="${TASK_FILE#vault/}"

            # Complete task
            exocortex command complete "$RELATIVE_PATH" --vault vault

            echo "✓ Completed task: $RELATIVE_PATH"
          fi

      - name: Commit and push
        working-directory: vault
        run: |
          git config user.name "GitHub Actions"
          git config user.email "actions@github.com"
          git add .
          git commit -m "Complete task: ${{ steps.extract.outputs.task_uid }}" || echo "No changes"
          git push || echo "No changes to push"
```

---

### Daily Task Status Report

Send daily summary of task status.

**.github/workflows/daily-status.yml:**
```yaml
name: Daily Task Status Report

on:
  schedule:
    - cron: '0 9 * * 1-5'  # Weekdays at 9 AM UTC

jobs:
  status-report:
    runs-on: ubuntu-latest

    steps:
      - name: Checkout vault
        uses: actions/checkout@v3
        with:
          repository: username/my-vault
          token: ${{ secrets.VAULT_TOKEN }}

      - name: Install Exocortex CLI
        run: npm install -g @kitelev/exocortex-cli

      - name: Generate status report
        run: |
          # Count tasks by status
          TODO=$(grep -r "ems__Effort_status.*ToDo" . | wc -l)
          DOING=$(grep -r "ems__Effort_status.*Doing" . | wc -l)
          DONE=$(grep -r "ems__Effort_status.*Done" . | wc -l)
          BACKLOG=$(grep -r "ems__Effort_status.*Backlog" . | wc -l)

          # Create report
          cat > report.md <<EOF
          ## Daily Task Status Report
          **Date:** $(date +%Y-%m-%d)

          ### Summary
          - **ToDo:** $TODO tasks
          - **Doing:** $DOING tasks
          - **Done:** $DONE tasks
          - **Backlog:** $BACKLOG tasks

          ### Overdue Tasks
          EOF

          # Find overdue tasks (scheduled before today, still in ToDo)
          TODAY=$(date +%Y-%m-%d)
          grep -r "ems__Effort_plannedStartTimestamp" . | \
            while IFS=: read file timestamp_line; do
              timestamp=$(echo "$timestamp_line" | grep -oP '\d{4}-\d{2}-\d{2}')

              if [[ "$timestamp" < "$TODAY" ]]; then
                # Check if still ToDo
                if grep -q "ems__Effort_status.*ToDo" "$file"; then
                  label=$(grep "exo__Asset_label:" "$file" | sed 's/.*: //')
                  echo "- $label ($timestamp)" >> report.md
                fi
              fi
            done

          cat report.md

      - name: Send to Slack
        env:
          SLACK_WEBHOOK: ${{ secrets.SLACK_WEBHOOK }}
        run: |
          REPORT=$(cat report.md)

          curl -X POST "$SLACK_WEBHOOK" \
            -H 'Content-Type: application/json' \
            -d "{\"text\": \"$REPORT\"}"
```

---

## GitLab CI/CD

### Auto-Update Tasks from Commits

**.gitlab-ci.yml:**
```yaml
update_tasks:
  stage: deploy
  only:
    - main
  script:
    - git clone https://gitlab.com/username/my-vault.git vault
    - npm install -g @kitelev/exocortex-cli

    # Extract task UIDs from commit messages
    - |
      git log --pretty=format:"%s" -1 | grep -oP 'Task: \K[a-f0-9-]+' | while read uid; do
        TASK_FILE=$(find vault -name "${uid}.md" | head -1)

        if [ -n "$TASK_FILE" ]; then
          RELATIVE_PATH="${TASK_FILE#vault/}"

          # Check current status
          if grep -q "ems__Effort_status.*ToDo" "$TASK_FILE"; then
            # Start task if not started
            exocortex command start "$RELATIVE_PATH" --vault vault
          elif grep -q "ems__Effort_status.*Doing" "$TASK_FILE"; then
            # Complete task if doing
            exocortex command complete "$RELATIVE_PATH" --vault vault
          fi
        fi
      done

    # Commit changes
    - cd vault
    - git config user.name "GitLab CI"
    - git config user.email "ci@gitlab.com"
    - git add .
    - git commit -m "Update tasks from deployment" || echo "No changes"
    - git push https://oauth2:${VAULT_TOKEN}@gitlab.com/username/my-vault.git
```

---

### Archive Completed Tasks Weekly

**.gitlab-ci.yml:**
```yaml
archive_tasks:
  stage: maintenance
  only:
    - schedules
  script:
    - git clone https://gitlab.com/username/my-vault.git vault
    - npm install -g @kitelev/exocortex-cli

    # Archive tasks completed >30 days ago
    - |
      CUTOFF=$(date -d "30 days ago" +%Y-%m-%d)

      grep -r "ems__Effort_resolutionTimestamp" vault/03\ Knowledge/tasks | \
        while IFS=: read filepath timestamp_line; do
          timestamp=$(echo "$timestamp_line" | grep -oP '\d{4}-\d{2}-\d{2}')

          if [[ "$timestamp" < "$CUTOFF" ]]; then
            RELATIVE_PATH="${filepath#vault/}"
            exocortex command archive "$RELATIVE_PATH" --vault vault
            echo "Archived: $RELATIVE_PATH"
          fi
        done

    - cd vault
    - git config user.name "GitLab CI"
    - git config user.email "ci@gitlab.com"
    - git add .
    - git commit -m "Archive old completed tasks" || echo "No changes"
    - git push https://oauth2:${VAULT_TOKEN}@gitlab.com/username/my-vault.git
```

**GitLab Pipeline Schedule:**
- Navigate to CI/CD → Schedules
- Create schedule: "Weekly archive" - `0 0 * * 0` (Sundays at midnight)

---

## Automated Task Creation

### Email to Task

Python script to create tasks from emails.

**email-to-task.py:**
```python
#!/usr/bin/env python3
import imaplib
import email
import subprocess
import re
from datetime import datetime

# Email configuration
IMAP_SERVER = "imap.gmail.com"
EMAIL_ACCOUNT = "your-email@gmail.com"
EMAIL_PASSWORD = "your-app-password"

# Vault configuration
VAULT_PATH = "/path/to/vault"
TASK_DIR = "03 Knowledge/tasks"

def create_task_from_email(subject, body, sender):
    """Create Exocortex task from email"""
    # Generate filename from subject
    filename = re.sub(r'[^\w\s-]', '', subject.lower())
    filename = re.sub(r'[-\s]+', '-', filename)
    timestamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    filepath = f"{TASK_DIR}/email-{timestamp}-{filename}.md"

    # Create task
    result = subprocess.run([
        "exocortex", "command", "create-task", filepath,
        "--label", subject,
        "--vault", VAULT_PATH
    ], capture_output=True, text=True)

    if result.returncode == 0:
        # Add email content to task
        task_file = f"{VAULT_PATH}/{filepath}"
        with open(task_file, 'a') as f:
            f.write(f"\n## Email\n\n")
            f.write(f"**From:** {sender}\n\n")
            f.write(f"**Date:** {datetime.now().strftime('%Y-%m-%d %H:%M')}\n\n")
            f.write(f"### Message\n\n{body}\n")

        print(f"✓ Created task: {filepath}")
        return True
    else:
        print(f"✗ Failed to create task: {result.stderr}")
        return False

def process_emails():
    """Check inbox and create tasks"""
    # Connect to IMAP
    mail = imaplib.IMAP4_SSL(IMAP_SERVER)
    mail.login(EMAIL_ACCOUNT, EMAIL_PASSWORD)
    mail.select("inbox")

    # Search for unread emails with label "task"
    status, messages = mail.search(None, '(UNSEEN SUBJECT "task")')

    for num in messages[0].split():
        # Fetch email
        status, msg_data = mail.fetch(num, "(RFC822)")
        msg = email.message_from_bytes(msg_data[0][1])

        # Extract details
        subject = msg["subject"]
        sender = msg["from"]
        body = ""

        if msg.is_multipart():
            for part in msg.walk():
                if part.get_content_type() == "text/plain":
                    body = part.get_payload(decode=True).decode()
                    break
        else:
            body = msg.get_payload(decode=True).decode()

        # Create task
        if create_task_from_email(subject, body, sender):
            # Mark as read
            mail.store(num, '+FLAGS', '\\Seen')

    mail.close()
    mail.logout()

if __name__ == "__main__":
    process_emails()
```

**Cron schedule:**
```cron
# Check emails every 15 minutes
*/15 * * * * /path/to/email-to-task.py >> /var/log/email-to-task.log 2>&1
```

---

### Jira Integration

Sync Jira issues to Exocortex tasks.

**jira-sync.py:**
```python
#!/usr/bin/env python3
import requests
import subprocess
import json

# Jira configuration
JIRA_URL = "https://your-company.atlassian.net"
JIRA_EMAIL = "your-email@company.com"
JIRA_API_TOKEN = "your-api-token"

# Vault configuration
VAULT_PATH = "/path/to/vault"

def sync_jira_issues():
    """Sync Jira issues assigned to you"""
    # Query Jira API
    response = requests.get(
        f"{JIRA_URL}/rest/api/3/search",
        auth=(JIRA_EMAIL, JIRA_API_TOKEN),
        params={
            "jql": "assignee=currentUser() AND status!=Done",
            "fields": "summary,status,priority,created"
        }
    )

    issues = response.json()["issues"]

    for issue in issues:
        key = issue["key"]
        summary = issue["fields"]["summary"]
        status = issue["fields"]["status"]["name"]

        # Generate task filepath
        filepath = f"03 Knowledge/tasks/jira-{key.lower()}.md"

        # Check if task exists
        task_file = f"{VAULT_PATH}/{filepath}"

        # Create if doesn't exist
        result = subprocess.run([
            "find", VAULT_PATH, "-name", f"jira-{key.lower()}.md"
        ], capture_output=True, text=True)

        if not result.stdout.strip():
            # Create new task
            subprocess.run([
                "exocortex", "command", "create-task", filepath,
                "--label", f"{key}: {summary}",
                "--vault", VAULT_PATH
            ])

            # Add Jira metadata
            with open(task_file, 'a') as f:
                f.write(f"\n## Jira\n\n")
                f.write(f"- **Key:** {key}\n")
                f.write(f"- **URL:** {JIRA_URL}/browse/{key}\n")
                f.write(f"- **Status:** {status}\n")

            print(f"✓ Created: {key}")
        else:
            # Update existing task based on Jira status
            if status == "In Progress":
                subprocess.run([
                    "exocortex", "command", "start", filepath,
                    "--vault", VAULT_PATH
                ])
                print(f"✓ Started: {key}")
            elif status == "Done":
                subprocess.run([
                    "exocortex", "command", "complete", filepath,
                    "--vault", VAULT_PATH
                ])
                print(f"✓ Completed: {key}")

if __name__ == "__main__":
    sync_jira_issues()
```

---

## External Tool Integration

### Todoist to Exocortex Sync

**todoist-sync.sh:**
```bash
#!/bin/bash
# Sync Todoist tasks to Exocortex

VAULT_PATH="/path/to/vault"
TODOIST_TOKEN="your-todoist-api-token"

# Get active Todoist tasks
curl -X GET \
  "https://api.todoist.com/rest/v2/tasks" \
  -H "Authorization: Bearer $TODOIST_TOKEN" \
  | jq -r '.[] | "\(.id),\(.content),\(.due.date // "no-date")"' \
  | while IFS=',' read id content due_date; do

  # Generate task filename
  filepath="03 Knowledge/tasks/todoist-$id.md"

  # Check if task exists
  if [ ! -f "$VAULT_PATH/$filepath" ]; then
    # Create task
    exocortex command create-task "$filepath" \
      --label "$content" \
      --vault "$VAULT_PATH"

    # Schedule if has due date
    if [ "$due_date" != "no-date" ]; then
      exocortex command schedule "$filepath" \
        --date "$due_date" \
        --vault "$VAULT_PATH"
    fi

    echo "✓ Synced from Todoist: $content"
  fi
done
```

---

### Notion Database Sync

**notion-sync.js:**
```javascript
#!/usr/bin/env node
const { Client } = require("@notionhq/client");
const { exec } = require("child_process");
const util = require("util");
const execAsync = util.promisify(exec);

const notion = new Client({ auth: process.env.NOTION_TOKEN });
const databaseId = process.env.NOTION_DATABASE_ID;
const vaultPath = process.env.VAULT_PATH;

async function syncNotionTasks() {
  // Query Notion database
  const response = await notion.databases.query({
    database_id: databaseId,
    filter: {
      property: "Status",
      select: {
        does_not_equal: "Done"
      }
    }
  });

  for (const page of response.results) {
    const title = page.properties.Name.title[0].plain_text;
    const notionId = page.id;
    const filepath = `03 Knowledge/tasks/notion-${notionId}.md`;

    // Check if task exists
    const { stdout } = await execAsync(
      `find "${vaultPath}" -name "notion-${notionId}.md"`
    );

    if (!stdout.trim()) {
      // Create task
      await execAsync(
        `exocortex command create-task "${filepath}" --label "${title}" --vault "${vaultPath}"`
      );

      console.log(`✓ Synced from Notion: ${title}`);
    }
  }
}

syncNotionTasks().catch(console.error);
```

**Package.json:**
```json
{
  "dependencies": {
    "@notionhq/client": "^2.2.0"
  }
}
```

**Run:**
```bash
export NOTION_TOKEN="your-notion-integration-token"
export NOTION_DATABASE_ID="your-database-id"
export VAULT_PATH="/path/to/vault"
node notion-sync.js
```

---

## Webhook Automation

### Webhook Server for External Events

**webhook-server.js:**
```javascript
#!/usr/bin/env node
const express = require("express");
const { exec } = require("child_process");
const util = require("util");
const execAsync = util.promisify(exec);

const app = express();
app.use(express.json());

const VAULT_PATH = process.env.VAULT_PATH || "/path/to/vault";

// Webhook endpoint for task creation
app.post("/webhook/create-task", async (req, res) => {
  try {
    const { label, area, date } = req.body;

    if (!label) {
      return res.status(400).json({ error: "Label required" });
    }

    // Generate filename
    const timestamp = Date.now();
    const filename = label.toLowerCase().replace(/\s+/g, "-");
    const filepath = `03 Knowledge/tasks/webhook-${timestamp}-${filename}.md`;

    // Create task
    let command = `exocortex command create-task "${filepath}" --label "${label}" --vault "${VAULT_PATH}"`;

    if (area) {
      command += ` --area "${area}"`;
    }

    await execAsync(command);

    // Schedule if date provided
    if (date) {
      await execAsync(
        `exocortex command schedule "${filepath}" --date "${date}" --vault "${VAULT_PATH}"`
      );
    }

    res.json({ success: true, filepath });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Webhook endpoint for status updates
app.post("/webhook/update-status", async (req, res) => {
  try {
    const { uid, status } = req.body;

    // Find task file
    const { stdout } = await execAsync(
      `find "${VAULT_PATH}" -name "${uid}.md"`
    );

    if (!stdout.trim()) {
      return res.status(404).json({ error: "Task not found" });
    }

    const filepath = stdout.trim().replace(`${VAULT_PATH}/`, "");

    // Update status
    const commandMap = {
      start: "start",
      complete: "complete",
      todo: "move-to-todo",
      backlog: "move-to-backlog"
    };

    const command = commandMap[status];

    if (!command) {
      return res.status(400).json({ error: "Invalid status" });
    }

    await execAsync(
      `exocortex command ${command} "${filepath}" --vault "${VAULT_PATH}"`
    );

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.listen(3000, () => {
  console.log("Webhook server listening on port 3000");
});
```

**Start server:**
```bash
export VAULT_PATH="/path/to/vault"
node webhook-server.js
```

**Usage:**
```bash
# Create task via webhook
curl -X POST http://localhost:3000/webhook/create-task \
  -H "Content-Type: application/json" \
  -d '{"label": "New task from webhook", "date": "2025-11-25"}'

# Update task status
curl -X POST http://localhost:3000/webhook/update-status \
  -H "Content-Type: application/json" \
  -d '{"uid": "task-uid-123", "status": "start"}'
```

---

## Scheduled Maintenance

### Cron Jobs for Regular Maintenance

**crontab:**
```cron
# Daily cleanup at 2 AM
0 2 * * * /path/to/scripts/daily-cleanup.sh >> /var/log/exocortex-cleanup.log 2>&1

# Weekly archive on Sundays at 3 AM
0 3 * * 0 /path/to/scripts/weekly-archive.sh >> /var/log/exocortex-archive.log 2>&1

# Sync external tools every 30 minutes
*/30 * * * * /path/to/scripts/external-sync.sh >> /var/log/exocortex-sync.log 2>&1

# Generate daily report at 9 AM on weekdays
0 9 * * 1-5 /path/to/scripts/daily-report.sh >> /var/log/exocortex-report.log 2>&1
```

---

## Related Documentation

- [Command Reference](./Command-Reference.md) - Complete command syntax
- [Scripting Patterns](./Scripting-Patterns.md) - Bash scripting examples
- [Troubleshooting](./Troubleshooting.md) - Debugging integration issues

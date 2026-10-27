## 2026-10-27 - Task: Stop the deployment and publish sanitized source

### What was done

- Stopped the production admin panel, scheduled task, active temporary job, and
  project Redis container. Retained deployment configuration and persistent data.
- Synchronized existing deployed time validation, settings restart behavior,
  extended task waiting, and secondary-verification notifications into source.
- Kept the pending publish-only button change and upstream attribution.
- Documented manual versus scheduled operation, stopping, resuming, and safe
  source publishing. Deployment addresses and credentials remain user-supplied.

### Testing

- Verified no running containers matching the project's container-name prefix
  after stopping. The active job was interrupted; no production task was rerun.
- Compared `admin-panel/server.js` and `login.py` with the deployed files:
  identical content after line-ending normalization.
- `node --check admin-panel/server.js`, `node --check admin-panel/public/app.js`,
  and `git diff --check` passed.
- Isolated Node tests passed for time normalization, invalid input rejection
  without writing settings, save/restart order, busy-state rejection and cleanup,
  publish-only/full-run commands, 900-second job limit and 960-second Docker wait.
  Docker, filesystem writes, and timers were mocked.
- Python AST parsing passed. Isolated notification tests passed for payload
  construction, 300-second deduplication, method separation, and error logging.
  No real webhook was called, and login dependencies were not imported.
- Scanned the three pre-release commits for known private values and credential
  patterns. No known private values were found. An IPv4-pattern match was the
  public Chrome user-agent version, not a server address.
- Verified `.env`, the password file, logs, debug images, Redis data, and browser
  profiles are excluded by Git ignore rules.
- Real account login, browser verification, and notification delivery were not
  retested because the deployment was deliberately stopped.

### Notes

- `admin-panel/server.js`: synchronized deployed time validation, restart-on-save,
  and extended Docker/task timeout behavior.
- `login.py`: synchronized deployed secondary-verification notifications and
  duplicate-message suppression; no new login flow was designed.
- `README.md`: described publish-only execution, restart behavior, notification
  privacy, and the operations guide.
- `docs/operations.md`: added data-preserving stop/resume commands and publishing
  guidance without private deployment details.
- `progress.md`: recorded this task, validation evidence, scope, and rollback.
- Source rollback point: `6666153`. After the source-sync commit is created and
  remains HEAD, `git revert HEAD` reverts this sync without rewriting history.
  The earlier publish-only commit is separate.
- Operational rollback: in your deployment directory, run
  `docker compose start redis admin-panel`; additionally run
  `docker compose start netease-musician-task` only to resume scheduled jobs.
- Scope: this release synchronizes existing server source and documentation.
  Other server projects and their schedules were not changed.

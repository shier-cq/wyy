# Operations and Source Publishing

## Stop Without Deleting Data

Run these commands from your own deployment directory. Stop the panel first so
it cannot create more temporary jobs while shutting down.

```bash
docker compose stop admin-panel netease-musician-task
runs=$(docker ps -q --filter 'name=^/netease-musician-run-')
if [ -n "$runs" ]; then
  docker stop -t 30 $runs
fi
docker compose stop redis
docker ps --filter 'name=^/netease-musician-'
```

The final command should show no running project containers. Stopping interrupts
active jobs and makes the panel unavailable. It retains `.env`, Redis data,
browser profiles, logs, and containers. Do not delete data directories or volumes.

## Resume Deliberately

For panel access and manual jobs only:

```bash
docker compose start redis admin-panel
```

To resume scheduled jobs as well:

```bash
docker compose start netease-musician-task
```

Saving settings in the panel recreates and starts the main task container.
The restart button also starts it. Stop `netease-musician-task` again after
either action if you want manual execution only.

## Included Deployment Changes

- The publish button runs `interval_task_runner()` rather than the full task set.
  Upstream interval, eligibility, and monthly limits still apply.
- Daily times are normalized to `HH:MM`; invalid values are rejected.
- Saving settings restarts the task container with the updated configuration.
- Temporary jobs have a 900-second execution limit. Docker's wait request allows
  960 seconds; other Docker requests retain their 120-second timeout.
- Secondary verification sends notifications through the configured notification
  backend. Identical account/method/message combinations are suppressed for
  300 seconds within the same process. Notifications can include account and
  SMS instructions; use only trusted recipients.

## Publish Source Only

Use `.env.example` as the public template. Each deployer supplies their own server
address, absolute `PROJECT_HOST_DIR`, admin password, accounts, and webhook keys.
Do not upload `.env`, credentials, SSH keys, logs, debug screenshots, Redis data,
or browser profiles. Check staged files and commit history before pushing.

Uploading code does not restart or redeploy the server. Validate source without
starting production jobs when the deployment is intentionally stopped.

The local code baseline before the 2026-10-27 source sync is commit `6666153`.
Use a normal revert of the source-sync commit to undo that release; production
data is separate from Git and must not be replaced with example configuration.

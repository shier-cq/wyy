# NetEase Musician Task Admin Panel

This repository contains a Docker Compose deployment wrapper and a small web admin panel for `xinghehy/netease-musician-task`.

The admin panel lets you:

- Configure task schedules and notification webhooks.
- Add or remove NetEase account tasks stored in Redis.
- Run the task once from the browser.
- Handle secondary login verification, including QR/device confirmation and SMS-send confirmation.
- View container status and recent logs.

## Deploy

1. Clone this repository on your server.

2. Create your runtime config:

   ```bash
   cp .env.example .env
   ```

3. Edit `.env`.

   Important values:

   - `PROJECT_HOST_DIR`: absolute path to this project on your server.
   - `ADMIN_PANEL_PASSWORD`: password used to enter the admin panel.
   - `WECOM_WEBHOOK_KEY`: optional Enterprise WeCom robot key. Paste only the value after `key=`.
   - `CUSTOM_WEBHOOK_URL`: optional custom webhook. If set, it takes precedence over WeCom.

4. Start the services:

   ```bash
   docker compose up -d --build
   docker compose stop netease-musician-task
   ```

5. Open the panel:

   ```text
   http://YOUR_SERVER_IP:18080
   ```

## Security

Do not commit `.env`, logs, Redis data, browser profiles, debug screenshots, account passwords, webhook keys, or server IPs. They are ignored by `.gitignore`.

Use `.env.example` as the public template and keep real values only on your own server.

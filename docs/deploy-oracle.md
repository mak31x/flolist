# Deploy runbook: Oracle Cloud Always-Free (Ampere A1, arm64)

Read this in M0.4 (first deploy) and M8 (hardening). Update it whenever the real setup changes.

## Target
- Ampere A1 Flex VM. Always Free allows up to 4 OCPU / 24 GB RAM in total across A1 instances; check the current limits in the OCI console. OS: Ubuntu 24.04 LTS (aarch64).
- Budget for Flolist: about 2 OCPU and 2–4 GB RAM. Postgres needs about 1 GB, api + worker about 0.5 GB, and Caddy/MinIO are small.
- If you reuse the VM that runs n8n (Q-3), put **one** reverse proxy in front of both: either Caddy for both, or a Flolist site block added to the existing proxy. Never run two proxies on ports 80/443.

## One-time server setup
1. OCI networking: open TCP 22 (your IP only), 80 and 443 in the VCN security list or NSG.
2. OCI's Ubuntu images ship restrictive **iptables** rules, so open 80 and 443 there too: `iptables -I INPUT -p tcp --dport 80 -j ACCEPT` (same for 443), then `netfilter-persistent save`. This is the most common cause of "site unreachable".
3. Create a `deploy` user with SSH keys only and password auth disabled. Enable `unattended-upgrades` and `fail2ban`.
4. Install Docker Engine and the compose plugin (arm64, from Docker's apt repo).
5. Create `/opt/flolist/` containing `docker-compose.prod.yml`, `Caddyfile`, `.env` (chmod 600), `web/` (static build) and `backups/`.
6. DNS: point an A record `app.<domain>` at the VM's public IP. Optionally add `staging.<domain>`, and an `in.<domain>` MX record for email forwarding in M9. With Cloudflare DNS, keep the record DNS-only for the first certificate, or use origin certs.
   - **Variant with no open ports:** run a Cloudflare Tunnel (`cloudflared` container) to `caddy:80`. WebSockets work through it. If you choose this, log it in decisions.md.

## Compose services (prod)
| Service | Image | Notes |
|---|---|---|
| caddy | caddy:2 (arm64) | serves `/srv/web`, proxies `/api/*` and `/ws` to `api:3000`, auto-TLS; long cache for hashed assets, no-cache for `index.html` and the service worker |
| api | ghcr.io/<owner>/flolist-api:<sha> | `NODE_ENV=production`; healthcheck `/api/health` |
| worker | ghcr.io/<owner>/flolist-worker:<sha> | can share the api image with a different command |
| postgres | postgres:17 (or current stable) | volume `pgdata`; `shared_buffers=256MB` |
| minio *(optional)* | minio/minio | only if not using OCI Object Storage |

Images are multi-stage `node:<lts>-slim` builds using `pnpm deploy --prod` for a minimal `node_modules`, targeting `linux/arm64`.

## Env (documented in `.env.example`)
`DATABASE_URL`, `APP_URL`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `GOOGLE_CLIENT_ID/SECRET`, `SMTP_HOST/PORT/USER/PASS/FROM`, `S3_ENDPOINT/REGION/BUCKET/ACCESS_KEY/SECRET_KEY`, `VAPID_PUBLIC/PRIVATE/SUBJECT`, `FCM_SERVICE_ACCOUNT_JSON` (M11), `ENCRYPTION_KEY`, `MAX_UPLOAD_MB=25`, `MAX_LIST_MEMBERS=25`, `MAX_TEAM_MEMBERS=`, `TRASH_RETENTION_DAYS=` (empty = never).

## CI/CD (GitHub Actions)
1. **On PR:** `pnpm install --frozen-lockfile`, `pnpm check` (with a Postgres service), Playwright against compose.dev.
2. **On push to main:** `docker buildx build --platform linux/arm64` (a native arm64 runner if available, otherwise QEMU), push to GHCR tagged `sha` and `latest`. Build the web bundle as an artifact.
3. **Deploy job:** SSH to the VM → rsync the web build to `/opt/flolist/web` → `docker compose pull` → `docker compose run --rm api pnpm db:migrate` → `docker compose up -d` → health check → roll back to the previous tag on failure.
4. Native builds come later: Tauri macOS/Windows builds on matching runners (M10/M12), and Capacitor Android builds (M11).

## Backups and ops
- Nightly cron: `pg_dump -Fc` → gzip → upload to an OCI Object Storage bucket (S3 API). Keep 14 daily and 8 weekly copies. Run `infra/scripts/restore-test.sh` monthly.
- Logs: Docker json-file driver with a max-size. Optionally use Dozzle or the Grafana Cloud free tier.
- Uptime: an external monitor on `/api/health`. The owner's n8n can send WhatsApp alerts.
- Deploy only through CI (no Watchtower).
- Oracle reclaims idle Always-Free instances. The account is already on Pay-As-You-Go, which avoids this, but keep an eye on it.

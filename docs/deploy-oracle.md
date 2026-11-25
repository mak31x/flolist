# Deploy runbook: Oracle Cloud Always-Free (Ampere A1, arm64)

Read this in M0.4 (first deploy) and M8 (hardening). Update it whenever the real setup changes.

## Current production setup (M0.4, 2026-11-25)
- **Host:** the shared VM at 130.210.26.170 (Ampere A1, 2 OCPU, 11 GB, Ubuntu 24.04 aarch64). It also runs n8n (`/home/ubuntu/n8n-docker`) and app.leadfest.in (`/home/ubuntu/App.leadfest`). Flolist uses about 120 MB idle and is capped at about 1.9 GB by compose memory limits.
- **Front proxy:** the n8n stack's `caddy:2` container owns 80/443 and terminates TLS for every site. Flolist's own Caddy has no public port. It joins the `n8n-docker_default` network as `flolist-web` (the same way leadfest's `lms-web` does), and the front Caddyfile has:
  ```
  flolist.levitatinglabs.com {
  	reverse_proxy flolist-web:80
  }
  ```
  Edit `/home/ubuntu/n8n-docker/Caddyfile` **in place** (append with `tee -a`, don't let an editor replace the file: it's a single-file bind mount, so a new inode is invisible to the container), then `docker exec n8n-docker-caddy-1 caddy reload --config /etc/caddy/Caddyfile`.
- **DNS:** A record `flolist` → 130.210.26.170, **DNS-only** (grey cloud) on Cloudflare. Moving to `app.flolist.com` later = new DNS record + a front-proxy site block + `APP_URL` in `.env`.
- **Already present, not managed by us:** Docker 29 + compose v5, iptables rules for 22/80/443, fail2ban, unattended-upgrades, key-only SSH with no root login.
- **Set up by `infra/scripts/server-setup.sh`:** the `deploy` user (CI key only, `restrict`ed, in the `docker` group, which is root-equivalent), `/opt/flolist/{scripts,web-releases,backups}`, and `/etc/cron.d/flolist` (backup 02:30 UTC daily, restore test 04:00 UTC on the 1st).
- **`/opt/flolist`:** `.env` (from `infra/prod.env.example`, chmod 600), `docker-compose.prod.yml`, `Caddyfile`, `scripts/` (all three uploaded by every deploy), `web-releases/<sha>/` + `current` symlink, `.image-tag` (the live tag), and `backups/{daily,weekly}`.

## Deviations from the generic plan below
- One image (`ghcr.io/mak31x/flolist-api`) runs the api, the worker and migrations (`node dist/{api,worker,migrate}.js`). esbuild bundles everything, so the image has no `node_modules` (no `pnpm deploy`).
- Web builds are kept per release in `web-releases/<sha>` with an atomic `current` symlink, instead of a single `web/` folder, so a rollback restores the matching web build.
- Backups are `pg_dump -Fc -Z 6` (already compressed, no gzip) and stay on the VM until M8.3 moves them offsite.
- Migrations are never rolled back. Each migration must work with the previous release (expand/contract).

## CI/CD setup (one time)
1. Repo → Settings → Environments → `production`. Add the secrets `DEPLOY_HOST` (130.210.26.170), `DEPLOY_USER` (`deploy`), `DEPLOY_SSH_KEY` (the CI private key) and `DEPLOY_KNOWN_HOSTS` (the output of `ssh-keyscan -t ed25519 130.210.26.170`, checked against the VM's real host key), plus the variable `APP_URL`.
2. GHCR: `flolist-api` came out **public** on the first push (it inherits the public repo's visibility), so the VM pulls without a token. Check it with `curl -s "https://ghcr.io/token?scope=repository:mak31x/flolist-api:pull"` (a token comes back = public). If it ever shows as private: GitHub → Packages → `flolist-api` → Package settings → Public.
3. Workflows: `check.yml` runs on PRs; `deploy.yml` runs on every push to main (check → arm64 image on `ubuntu-24.04-arm` + web bundle → `deploy.sh` over SSH → public health check). A failed health check on the VM rolls back to the previous image and web build.

## Target
- Ampere A1 Flex VM. Always Free allows up to 4 OCPU / 24 GB RAM in total across A1 instances; check the current limits in the OCI console. OS: Ubuntu 24.04 LTS (aarch64).
- Budget for Flolist: about 2 OCPU and 2–4 GB RAM. Postgres needs about 1 GB, api + worker about 0.5 GB, and Caddy and an optional S3 server are small.
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
| s3 *(optional)* | rustfs/rustfs (D-018; MinIO no longer ships images) | only if not using OCI Object Storage |

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

# Deploying Kiota on one Ubuntu server

This takes a brand-new Ubuntu server to a running Kiota with HTTPS, nightly backups and an
Arend admin account. Use it first for a **staging** site (for example `staging.kiota.app`), then
again for production.

Everything runs in Docker on one server:

| Container | What it does                                                                    |
| --------- | ------------------------------------------------------------------------------- |
| `db`      | PostgreSQL 17. Not reachable from the internet.                                 |
| `migrate` | Runs on every start: database migrations as the owner, then exits.              |
| `app`     | Kiota (Next.js). Connects as `kiota_app`, so row-level security always applies. |
| `caddy`   | Web server. Gets and renews HTTPS certificates automatically.                   |
| `backup`  | Every night: database dump and uploaded files, kept 14 days.                    |

---

## 1. The server

- **Ubuntu 24.04 LTS**, at least 2 CPUs, 4 GB RAM, 40 GB SSD.
- **Location:** the spec requires data hosted in or near Kenya. Choose a Kenyan data centre or the
  nearest region your provider has (for example Johannesburg or Cape Town), and record the choice
  in the data processing agreement.
- You need SSH access as a user with `sudo`, and the server's public IPv4 address (and IPv6 if it
  has one).

## 2. DNS records (at the domain registrar for kiota.app)

Add these **before** starting Kiota: Caddy needs them to get HTTPS certificates, and `.app`
addresses only work over HTTPS.

**Staging** (replace `203.0.113.10` with the server's IP):

| Type | Name          | Value          | TTL |
| ---- | ------------- | -------------- | --- |
| A    | `staging`     | `203.0.113.10` | 300 |
| A    | `www.staging` | `203.0.113.10` | 300 |
| A    | `app.staging` | `203.0.113.10` | 300 |

**Production:**

| Type | Name  | Value          | TTL  |
| ---- | ----- | -------------- | ---- |
| A    | `@`   | `203.0.113.10` | 3600 |
| A    | `www` | `203.0.113.10` | 3600 |
| A    | `app` | `203.0.113.10` | 3600 |

If the server has IPv6, add the same names as `AAAA` records with the IPv6 address. Check from
your laptop that they resolve before going on:

```bash
nslookup app.staging.kiota.app
```

## 3. Prepare the server

Connect and update:

```bash
ssh youruser@203.0.113.10
sudo apt update && sudo apt -y upgrade
sudo apt -y install git ufw unattended-upgrades
```

Firewall: only SSH and web traffic.

```bash
sudo ufw allow OpenSSH && sudo ufw allow 80/tcp && sudo ufw allow 443/tcp && sudo ufw allow 443/udp
sudo ufw --force enable
```

Install Docker (official repository):

```bash
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER
```

Log out and back in so the `docker` group applies, then check:

```bash
docker compose version
```

## 4. Get the code

The repository is private, so create a **deploy key** first:

```bash
ssh-keygen -t ed25519 -f ~/.ssh/kiota_deploy -N ""
cat ~/.ssh/kiota_deploy.pub
```

Add that public key on GitHub: repository → Settings → Deploy keys → Add (read-only). Then:

```bash
sudo mkdir -p /opt/kiota && sudo chown $USER /opt/kiota
GIT_SSH_COMMAND="ssh -i ~/.ssh/kiota_deploy" git clone git@github.com:arendpictures254-lab/Kiota.git /opt/kiota
cd /opt/kiota
git config core.sshCommand "ssh -i ~/.ssh/kiota_deploy"
```

## 5. Settings

```bash
cp .env.production.example .env.production
chmod 600 .env.production
openssl rand -hex 32   # run three times: owner password, app password, AUTH_SECRET
nano .env.production
```

Fill in every value (each is explained in the file). For staging:

```
SITE_DOMAIN=staging.kiota.app
APP_DOMAIN=app.staging.kiota.app
SMS_DRIVER=console
ALLOW_CONSOLE_SMS=1
```

`ALLOW_CONSOLE_SMS=1` prints sign-in codes in the app's log instead of sending SMS. Use it **only
on staging** until the Africa's Talking driver exists.

To save typing, add this shortcut (the rest of this guide uses it):

```bash
echo "alias kiota='docker compose -f /opt/kiota/docker-compose.prod.yml --env-file /opt/kiota/.env.production --project-directory /opt/kiota'" >> ~/.bashrc
source ~/.bashrc
```

## 6. Start Kiota

```bash
kiota up -d --build
```

The first build takes a few minutes. Then check:

```bash
kiota ps                      # db, app, caddy and backup should be "running" / "healthy"
kiota logs migrate            # should end with "Deploy setup done"
kiota logs caddy | grep -i certificate
curl https://app.staging.kiota.app/api/health   # {"status":"ok"}
```

Open `https://staging.kiota.app` (the site) and `https://app.staging.kiota.app` (sign in).

## 7. Create the first Arend admin

Admins create schools. They cannot see any school's records unless the school turns on support
access.

```bash
kiota run --rm migrate npx tsx scripts/create-admin.ts --phone 0720942426 --name "Your Name"
```

Sign in at the app address with that phone. On staging, read the code from the log:

```bash
kiota logs app | grep "SMS to" | tail -1
```

Then use **Create a school** to set up the pilot school and its Director.

## 8. Updating after new commits

```bash
cd /opt/kiota
git pull
kiota up -d --build
```

`migrate` runs before the new app starts, so the database is always updated first. Expect a few
seconds of downtime while the app container restarts. Check `kiota ps` and the health address
afterwards.

**Going back:** migrations only move forward. If an update goes wrong, restore last night's backup
(section 9) and check out the previous commit (`git checkout <commit>` then `kiota up -d --build`).

## 9. Backups

Every night at 02:00 (Nairobi time) the `backup` container writes:

- `/opt/kiota/backups/db/kiota-YYYY-MM-DD.dump` (the whole database), and
- `/opt/kiota/backups/files/kiota-files-YYYY-MM-DD.tar.gz` (photos, documents, uploaded imports).

Fourteen days are kept. Make one right now, and after any big change:

```bash
kiota run --rm backup now
ls -lh /opt/kiota/backups/db
```

**Copy backups off the server.** A backup that only lives on the same server is lost with it.
Do at least one of these:

- **From your laptop** (Linux, macOS, or Windows with WSL), daily or weekly:

  ```bash
  rsync -avz youruser@203.0.113.10:/opt/kiota/backups/ ~/kiota-backups/
  ```

  On Windows without WSL, use WinSCP to download `/opt/kiota/backups`.

- **Automatically to cloud storage** with `rclone` (Backblaze B2, Google Drive, S3...):

  ```bash
  sudo apt -y install rclone
  rclone config                       # create a remote, e.g. "offsite"
  crontab -e                          # then add:
  30 3 * * * rclone copy /opt/kiota/backups offsite:kiota-backups --max-age 48h
  ```

Backups contain children's personal data: keep the copies encrypted and access-controlled.

**Restoring** (this replaces the current data):

```bash
kiota stop app
kiota exec -T db pg_restore -U kiota_owner -d kiota --clean --if-exists < backups/db/kiota-2027-01-15.dump
docker run --rm -v kiota_storage:/data/storage -v /opt/kiota/backups/files:/b alpine \
  sh -c "rm -rf /data/storage/* && tar -xzf /b/kiota-files-2027-01-15.tar.gz -C /data"
kiota up -d
```

Practise a restore on staging before the pilot goes live.

## 10. Keeping an eye on it

- Add an uptime check (for example UptimeRobot) on `https://app.kiota.app/api/health`.
- `kiota logs -f app` shows the app; `kiota logs backup` shows backup runs.
- Ubuntu installs security updates automatically (`unattended-upgrades`). Reboot when
  `/var/run/reboot-required` exists; all containers restart on their own.

## Environment variables

All settings are documented in [`.env.production.example`](../.env.production.example). Docker
Compose builds the database addresses from them, so the app never connects as the owner.

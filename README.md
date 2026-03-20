# Speed Inventory Management

A full-stack inventory management MVP for a storage operation using React on the frontend, Go on the backend, and MariaDB as the database.

## What is included

- Dashboard with total inventory, total units, low-stock alerts, and recent stock activity
- Inventory item management with SKU, category, quantity, reorder level, and storage location
- Stock movement tracking for inbound, outbound, and adjustment operations
- MariaDB schema and seed data
- Docker Compose setup for running the full stack together

## Project structure

```text
.
|-- backend
|-- database
|-- frontend
|-- docker-compose.yml
```

## Quick start with Docker

1. Make sure Docker Desktop is running.
2. From the project root, run:

```bash
docker compose up --build
```

3. Open the apps:

- Frontend: http://localhost:5173
- Backend API: http://localhost:8080/api/health

## Production deploy on a VM

This repo includes a production Docker Compose file for a single VM deployment:

- [docker-compose.prod.yml](/c:/Users/zihao/Desktop/Projects/SpeedInventoryManagement/docker-compose.prod.yml)
- [docker-compose.https.yml](/c:/Users/zihao/Desktop/Projects/SpeedInventoryManagement/docker-compose.https.yml)
- [frontend/Dockerfile.prod](/c:/Users/zihao/Desktop/Projects/SpeedInventoryManagement/frontend/Dockerfile.prod)
- [frontend/nginx.conf](/c:/Users/zihao/Desktop/Projects/SpeedInventoryManagement/frontend/nginx.conf)
- [deploy/nginx/templates/http.conf.template](/c:/Users/zihao/Desktop/Projects/SpeedInventoryManagement/deploy/nginx/templates/http.conf.template)
- [deploy/nginx/templates/https.conf.template](/c:/Users/zihao/Desktop/Projects/SpeedInventoryManagement/deploy/nginx/templates/https.conf.template)

Recommended use case:

- One Oracle / GCP / AWS VM
- Docker running on the VM
- Frontend served by Nginx on port `80`
- Backend and MariaDB kept internal to Docker

### 1. Install Docker on the VM

```bash
sudo apt update
sudo apt install -y docker.io docker-compose-v2 git
sudo systemctl enable --now docker
sudo usermod -aG docker $USER
newgrp docker
```

### 2. Clone the project

```bash
git clone <your-repo-url>
cd SpeedInventoryManagement
```

### 3. Create a production env file

```bash
cat > .env.prod <<'EOF'
MARIADB_ROOT_PASSWORD=change-this-root-password
MARIADB_DATABASE=speed_inventory_management
MARIADB_USER=inventory_user
MARIADB_PASSWORD=change-this-db-password
FRONTEND_ORIGIN=http://YOUR_PUBLIC_IP
VITE_API_BASE_URL=/api
EOF
```

Replace `YOUR_PUBLIC_IP` with your VM public IP or domain.

### 4. Start the production stack

```bash
docker compose --env-file .env.prod -f docker-compose.prod.yml up -d --build
```

### 5. Verify the deployment

```bash
docker compose --env-file .env.prod -f docker-compose.prod.yml ps
docker compose --env-file .env.prod -f docker-compose.prod.yml logs -f
```

### 6. Open the app

- Frontend: `http://YOUR_PUBLIC_IP`
- Health check through Nginx proxy: `http://YOUR_PUBLIC_IP/api/health`

### Security notes

- Open only ports `22` and `80` on the VM firewall / cloud security rules
- Do not expose `3306`
- The production compose file keeps MariaDB and the Go API internal to Docker

## Current server architecture

The current production server runs on a single Oracle VM and uses Docker Compose for the full app stack.

### Runtime layers

- Public entry:
  - `speed-inventory-proxy` on ports `80` and `443`
  - Handles TLS termination and Let's Encrypt HTTP challenge traffic
- Application layer:
  - `speed-inventory-web` for the React frontend
  - `speed-inventory-api` for the Go backend
- Data layer:
  - `speed-inventory-db` for MariaDB

### Request flow

1. A browser requests `https://www.corgi4ever.com`
2. `speed-inventory-proxy` receives the request
3. Requests are routed by path:
   - `/api/*` -> `speed-inventory-api:8080`
   - all other requests -> `speed-inventory-web:80`
4. `speed-inventory-api` talks to `speed-inventory-db`

### External ports

- `22` for SSH
- `80` for HTTP and Let's Encrypt challenge validation
- `443` for HTTPS

These are not exposed publicly:

- `3306`
- `8080`
- the frontend container's internal `80`

### Container topology

```text
Internet
  |
  |  HTTPS :443 / HTTP :80
  v
+--------------------------------------+
| Oracle Cloud VM                      |
|                                      |
|  Docker Compose                      |
|                                      |
|  +--------------------------------+  |
|  | speed-inventory-proxy          |  |
|  | Nginx reverse proxy            |  |
|  | - TLS termination              |  |
|  | - Let's Encrypt challenge      |  |
|  | - /api -> backend              |  |
|  | - / -> frontend                |  |
|  +----------------+---------------+  |
|                   |                  |
|        +----------+----------+       |
|        |                     |       |
|        v                     v       |
|  +-------------+      +-------------+|
|  | speed-      |      | speed-      ||
|  | inventory-  |      | inventory-  ||
|  | web         |      | api         ||
|  | React app   |      | Go backend  ||
|  | internal 80 |      | internal8080||
|  +-------------+      +------+------||
|                                   |  |
|                                   v  |
|                           +-------------+
|                           | speed-      |
|                           | inventory-  |
|                           | db          |
|                           | MariaDB 11  |
|                           | internal3306|
|                           +-------------+
|
+--------------------------------------+
```

## HTTPS with Nginx and Let's Encrypt

Use the dedicated HTTPS stack instead of modifying the working HTTP stack in place. The HTTPS stack adds:

- an external `reverse-proxy` Nginx container on `80/443`
- a `certbot` container for Let's Encrypt certificate issuance and renewal
- secure auth cookies for production

### 1. Update `.env.prod`

Add these values or update the existing ones:

```env
FRONTEND_ORIGIN=https://www.corgi4ever.com
SESSION_COOKIE_SECURE=true
SITE_DOMAIN=www.corgi4ever.com
SITE_DOMAIN_ALIASES=
```

If you also want the root domain, set:

```env
SITE_DOMAIN_ALIASES=corgi4ever.com
```

### 2. Open port `443`

In your VM or cloud security rules, allow:

- `22`
- `80`
- `443`

### 3. Stop the HTTP stack

```bash
docker compose --env-file .env.prod -f docker-compose.prod.yml down
```

### 4. Start the HTTPS stack in HTTP mode first

This starts the proxy on port `80` so Let's Encrypt can complete the challenge.

```bash
docker compose --env-file .env.prod -f docker-compose.https.yml up -d mariadb backend frontend reverse-proxy
```

### 5. Issue the certificate

Replace `you@example.com` with your email address.

For `www` only:

```bash
docker compose --env-file .env.prod -f docker-compose.https.yml run --rm certbot certonly --webroot -w /var/www/certbot -d www.corgi4ever.com --email you@example.com --agree-tos --no-eff-email
```

For `www` and the root domain:

```bash
docker compose --env-file .env.prod -f docker-compose.https.yml run --rm certbot certonly --webroot -w /var/www/certbot -d www.corgi4ever.com -d corgi4ever.com --email you@example.com --agree-tos --no-eff-email
```

### 6. Restart the Nginx reverse proxy

After the certificate exists, the proxy automatically switches to the TLS config on restart.

```bash
docker compose --env-file .env.prod -f docker-compose.https.yml restart reverse-proxy
```

### 7. Verify HTTPS

```bash
curl -I http://www.corgi4ever.com
curl -I https://www.corgi4ever.com
```

### 8. Renew certificates

Run this periodically from cron:

```bash
docker compose --env-file .env.prod -f docker-compose.https.yml run --rm certbot renew --webroot -w /var/www/certbot
docker compose --env-file .env.prod -f docker-compose.https.yml restart reverse-proxy
```

## Manual local setup

### Database

1. Start MariaDB locally.
2. Run the scripts in this order:

```sql
SOURCE database/schema.sql;
SOURCE database/seed.sql;
```

### Backend

1. Install Go 1.22 or newer.
2. Copy [backend/.env.example](/c:/Users/zihao/Desktop/Projects/SpeedInventoryManagement/backend/.env.example) to `backend/.env` if you want a local env file.
3. Set the matching database environment variables.
4. Run:

```bash
cd backend
go mod tidy
go run ./cmd/server
```

### Frontend

1. Install Node.js 18 or newer.
2. Copy [frontend/.env.example](/c:/Users/zihao/Desktop/Projects/SpeedInventoryManagement/frontend/.env.example) to `frontend/.env` if needed.
3. Run:

```bash
cd frontend
npm install
npm run dev
```

## API endpoints

- `GET /api/health`
- `GET /api/dashboard`
- `GET /api/locations`
- `GET /api/items`
- `POST /api/items`
- `PUT /api/items/:id`
- `DELETE /api/items/:id`
- `GET /api/movements`
- `POST /api/movements`

## Assumptions for this MVP

- One storage business using a single inventory catalog
- Each item has one primary storage location
- Stock movements change the current on-hand quantity for an item
- Historical movement rows store the location at the time of the movement

## Suggested next upgrades

- Authentication and user roles
- Purchase orders and suppliers
- Barcode or QR code scanning
- CSV import and export
- Multi-location transfer workflow

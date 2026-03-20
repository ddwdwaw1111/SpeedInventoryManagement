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
- [frontend/Dockerfile.prod](/c:/Users/zihao/Desktop/Projects/SpeedInventoryManagement/frontend/Dockerfile.prod)
- [frontend/nginx.conf](/c:/Users/zihao/Desktop/Projects/SpeedInventoryManagement/frontend/nginx.conf)

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

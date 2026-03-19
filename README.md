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

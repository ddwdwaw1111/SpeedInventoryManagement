# Scripts

Run all project scripts from the repository root:

`c:\Users\zihao\Desktop\Projects\SpeedInventoryManagement`

## Local Development

For day-to-day local validation, you do not need to rebuild the full Docker stack.
The recommended workflow is:

- Docker only runs MariaDB
- The backend runs locally with `go run`
- The frontend runs locally with `npm run dev`

Requirements:

- Docker Desktop / Docker Engine
- Go `1.22+` for local backend runs
- Node `24.x` and `npm` for local frontend runs

### PowerShell

Start only the local DB container:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\dev_local.ps1 -Target db
```

Run the backend locally:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\dev_local.ps1 -Target backend
```

Run the frontend locally:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\dev_local.ps1 -Target frontend
```

Start the DB and print the next commands:

```powershellFt
powershell -ExecutionPolicy Bypass -File .\scripts\dev_local.ps1 -Target all
```

Start the DB and open backend/frontend in separate PowerShell windows:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\dev_local.ps1 -Target all -LaunchWindows
```

### Bash

Start only the local DB container:

```bash
bash scripts/dev_local.sh --target db
```

Run the backend locally:

```bash
bash scripts/dev_local.sh --target backend
```

Run the frontend locally:

```bash
bash scripts/dev_local.sh --target frontend
```

Start the DB and print the next commands:

```bash
bash scripts/dev_local.sh --target all
```

Start the DB and launch backend/frontend in the background:

```bash
bash scripts/dev_local.sh --target all --launch
```

## Deployment

Build production images locally and optionally deploy them to the server:

```bash
bash scripts/deploy_prod.sh
bash scripts/deploy_prod.sh --platform linux/amd64
bash scripts/deploy_prod.sh --keep-local-archives 2
bash scripts/deploy_prod.sh --deploy --stack https --server-host 129.213.52.3 --ssh-key ~/.ssh/oracle-prod.key
```

## Data Migration

Export from the local Docker MariaDB, upload to the server, back up the remote database, then import:

```bash
bash scripts/migrate_local_data_to_server.sh
bash scripts/migrate_local_data_to_server.sh --local-db-container speed-inventory-db
bash scripts/migrate_local_data_to_server.sh --server-host 129.213.52.3 --ssh-key ~/.ssh/oracle-prod.key
```

## Seed Default Admin

Seed or update the default admin account.

Remote server:

```bash
bash scripts/seed_admin_user.sh
bash scripts/seed_admin_user.sh --admin-password "password"
```

Local Docker database:

```bash
bash scripts/seed_admin_user.sh --local
```

## Backend Test Scripts

Run backend integration tests:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\run_integration_tests.ps1
powershell -ExecutionPolicy Bypass -File .\scripts\run_integration_tests.ps1 -TestPattern "Integration"
```

Run confirmed inbound edit tests:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\run_confirmed_inbound_edit_tests.ps1
```

## Performance Tests

Read-only mixed traffic:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\run_perf_read_mix.ps1
```

Capacity ramp:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\run_perf_capacity.ps1
```

More details:

- [PERFORMANCE_TESTING.md](c:/Users/zihao/Desktop/Projects/SpeedInventoryManagement/scripts/PERFORMANCE_TESTING.md)

## Notes

- `deploy/nginx/start-proxy.sh` stays in its current directory because it is part of the nginx container startup flow.
- `frontend/node_modules/.bin/*` and similar dependency-provided binaries are not project scripts, so they are intentionally not listed here.

# Scripts
项目里给人直接使用的脚本已经统一整理到这个目录下。

请在仓库根目录运行这些命令：

`c:\Users\zihao\Desktop\Projects\SpeedInventoryManagement`

## Bash 脚本

### 1. 生产部署

本地构建生产镜像，并可选择上传到服务器后直接部署。

```bash
bash scripts/deploy_prod.sh
bash scripts/deploy_prod.sh --platform linux/amd64
bash scripts/deploy_prod.sh --keep-local-archives 2
bash scripts/deploy_prod.sh --deploy --stack https --server-host 129.213.52.3 --ssh-key ~/.ssh/oracle-prod.key
```

### 2. 本地数据库迁移到服务器

从本地 Docker MariaDB 导出数据，上传到服务器，备份远端数据库，再导入远端。

```bash
bash scripts/migrate_local_data_to_server.sh
bash scripts/migrate_local_data_to_server.sh --local-db-container speed-inventory-db
bash scripts/migrate_local_data_to_server.sh --server-host 129.213.52.3 --ssh-key ~/.ssh/oracle-prod.key
```

### 3. 补默认管理员账号

给数据库补默认管理员账号，或更新现有管理员账号。

远端服务器：

```bash
bash scripts/seed_admin_user.sh
bash scripts/seed_admin_user.sh --admin-password "password"
```

本地 Docker 数据库：

```bash
bash scripts/seed_admin_user.sh --local
```

## PowerShell 脚本

### 1. 运行后端集成测试

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\run_integration_tests.ps1
powershell -ExecutionPolicy Bypass -File .\scripts\run_integration_tests.ps1 -TestPattern "Integration"
```

### 2. 运行已确认收货单修改测试

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\run_confirmed_inbound_edit_tests.ps1
```

### 3. 运行性能测试

只读混合流量：

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\run_perf_read_mix.ps1
```

容量拐点测试：

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\run_perf_capacity.ps1
```

更完整的性能测试说明见：

- [PERFORMANCE_TESTING.md](c:/Users/zihao/Desktop/Projects/SpeedInventoryManagement/scripts/PERFORMANCE_TESTING.md)

## 说明

- `deploy/nginx/start-proxy.sh` 仍然保留在原目录，因为它是 nginx 容器启动链路的一部分，不属于通用运维脚本。
- `frontend/node_modules/.bin/*` 这类文件是依赖自带的二进制脚本，不属于项目脚本，所以没有整理进来。

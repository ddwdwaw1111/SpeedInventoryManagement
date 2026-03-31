# 性能测试

这套项目现在提供两类基于 `k6` 的性能测试脚本，默认通过 Docker 运行，不要求本机先安装 `k6`。

所有命令都请从仓库根目录运行：

`c:\Users\zihao\Desktop\Projects\SpeedInventoryManagement`

## 脚本说明

### 1. 只读混合流量

文件：

- [scripts/perf/read_only_mix.js](c:/Users/zihao/Desktop/Projects/SpeedInventoryManagement/scripts/perf/read_only_mix.js)
- [scripts/run_perf_read_mix.sh](c:/Users/zihao/Desktop/Projects/SpeedInventoryManagement/scripts/run_perf_read_mix.sh)
- [scripts/run_perf_read_mix.ps1](c:/Users/zihao/Desktop/Projects/SpeedInventoryManagement/scripts/run_perf_read_mix.ps1)

用途：

- 适合直接对生产环境做相对安全的只读压测
- 会先登录，再混合访问这些高频接口：
  - `/api/auth/me`
  - `/api/dashboard`
  - `/api/items`
  - `/api/inbound-documents`
  - `/api/outbound-documents`
  - `/api/customers`
  - `/api/locations`

默认阈值：

- 错误率 `< 1%`
- `p95 < 800ms`
- `p99 < 1500ms`

PowerShell：

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\run_perf_read_mix.ps1
powershell -ExecutionPolicy Bypass -File .\scripts\run_perf_read_mix.ps1 -BaseUrl "https://www.corgi4ever.com" -Rate 20 -Duration "5m"
```

Bash：

```bash
bash scripts/run_perf_read_mix.sh
BASE_URL="https://www.corgi4ever.com" RATE=20 DURATION=5m bash scripts/run_perf_read_mix.sh
```

### 2. 容量拐点测试

文件：

- [scripts/perf/capacity_ramp.js](c:/Users/zihao/Desktop/Projects/SpeedInventoryManagement/scripts/perf/capacity_ramp.js)
- [scripts/run_perf_capacity.sh](c:/Users/zihao/Desktop/Projects/SpeedInventoryManagement/scripts/run_perf_capacity.sh)
- [scripts/run_perf_capacity.ps1](c:/Users/zihao/Desktop/Projects/SpeedInventoryManagement/scripts/run_perf_capacity.ps1)

用途：

- 用逐步升压的方式找出吞吐和延迟开始明显恶化的点
- 默认会把流量逐步抬到：
  - `10 req/s`
  - `25 req/s`
  - `50 req/s`
  - `75 req/s`
  - `100 req/s`

PowerShell：

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\run_perf_capacity.ps1
powershell -ExecutionPolicy Bypass -File .\scripts\run_perf_capacity.ps1 -BaseUrl "https://www.corgi4ever.com" -Stage3Rate 60 -Stage4Rate 90 -Stage5Rate 120
```

Bash：

```bash
bash scripts/run_perf_capacity.sh
BASE_URL="https://www.corgi4ever.com" STAGE5_RATE=120 bash scripts/run_perf_capacity.sh
```

## 登录账号

默认使用：

- 邮箱：`admin@gmail.com`
- 密码：`password`

注意：

- 这个账号必须是 `active` 状态
- 如果线上这个账号已经被禁用，请改用你自己的活跃管理员账号
- 或先运行 [seed_admin_user.sh](c:/Users/zihao/Desktop/Projects/SpeedInventoryManagement/scripts/seed_admin_user.sh) 把默认管理员重新设为可用

如果你想换账号，传环境变量或参数即可：

PowerShell：

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\run_perf_read_mix.ps1 -LoginEmail "admin@gmail.com" -LoginPassword "password"
```

Bash：

```bash
LOGIN_EMAIL="admin@gmail.com" LOGIN_PASSWORD="password" bash scripts/run_perf_read_mix.sh
```

## 输出结果

测试结束后，摘要 JSON 会写到：

- `dist/perf/read-only-mix-*.json`
- `dist/perf/capacity-ramp-*.json`

同时 `k6` 也会在终端里输出：

- `http_reqs`
- `iteration_duration`
- `http_req_duration`
- `http_req_failed`
- 各接口的响应时间分布

## 如何判断大概能支撑多少人

一个很实用的估算方式是：

`同时在线活跃用户数 ≈ 稳定 req/s × 人均发起请求间隔（秒）`

举例：

- 如果测试结果表明系统在 `20 req/s` 下仍然稳定
- 仓库人员平均每 `3~5 秒` 发一个请求

那么大致可以估算：

- 忙碌操作场景：`20 × 3 = 60` 个活跃用户
- 普通浏览场景：`20 × 5 = 100` 个活跃用户

这只是经验估算，不是严格 SLA。

## 推荐测试顺序

1. 先跑只读混合流量，确认生产环境在低压下稳定。
2. 再跑容量拐点测试，找出：
   - 错误率开始升高的点
   - `p95` 明显变差的点
3. 把那个点以下留出 `20%~30%` 余量，作为你当前服务器的安全容量。

## 注意

- 这两套脚本默认都是只读接口，适合生产环境压测。
- 不建议在生产环境直接压创建、确认、取消这类会改库存的写接口。
- 如果后面你想压入库确认、出库确认、调拨这类写操作，建议单独做一套只跑在 staging 的脚本。

# 雀记 · 在线麻将记分 + 整蛊条件卡

[![CI](https://github.com/Lzf07123/Li-Mahjong/actions/workflows/ci.yml/badge.svg)](https://github.com/Lzf07123/Li-Mahjong/actions/workflows/ci.yml)
[![Release](https://img.shields.io/badge/release-v1.0.0-0b3d2e)](https://github.com/Lzf07123/Li-Mahjong/releases)

四人麻将牌桌的实时记分网页：一人建房，其他人扫码/输房间码加入，各用自己手机实时看总分；
每局开始自动给每人发一张「整蛊条件卡」（内置 73 张题库，源自经典牌桌纸条），支持自定义题库；
手动记账流水、撤销、历史战局复盘与累计盈亏统计。支持**观战**与**手机添加到主屏（PWA）**。

**全流程 Docker 化**：开发、测试、生产都在容器内运行，宿主机只需安装 Docker。
**CI**：每次 push / PR 自动跑 lint + 冒烟（90 项）+ 安全（45 项）+ 前端构建 + 持久化重启验证（见 `.github/workflows/ci.yml`）。

## 功能

- 🏠 **房间**：创建/加入（4 位房间码 + 二维码扫码直达）、**标准四人局（东南西北）**、方位自选（被占置灰）、
  踢人、解散、断线自动重连；玩家可随时**退出战局**（离场者分数照常归档）；
  首页「**回到战局**」横幅一键回到进行中的对局；主动离开/被踢后刷新不会自动重进
- 👀 **观战**：任何人可「以观战身份进入」房间（房间门禁页随时可进，满员也能进），
  实时看总分、亮出的条件卡与流水，不占座位、不参与记分与结算；房主可移出观战者（单房上限 20 人）
- 🔐 **账号体系**：注册/登录后开局；**登录名**（唯一、不可改）与**昵称**（显示名，可随时改）分离；
  密码 ≥8 位且含字母和数字（scrypt 加盐哈希，会话 30 天）；登录/注册带图形验证码；
  已登录可自助改昵称和密码（需验证当前密码），忘记密码联系管理员重置；
  同账号重复加入自动回合同一玩家；战绩按账号聚合；
  **单点登录**：同一账号同一时间仅一处登录，别处登录自动顶掉旧设备（正在房间中也会被请离）
- 🀫 **条件卡**：每局一键发牌、3D 翻牌动画（牌背 → 扫光亮出）、仅自己可见/亮牌给全场、
  房主可对任意玩家「重摸 / 作废」、全员重摸（纸条作废）、「一晚限一次」卡自动去重
- 📚 **题库**：内置 73 张（出牌声音 / 动作惩罚 / 胡牌限制 / 行为限制 / 情报换牌 / 全场效果 6 类），
  按分类或单卡启停，自定义增删改（全局共享）
- 💰 **记分**：**付款方固定为记账人本人**（只能从自己的分数给出，收入由对方自己记，防止乱账）→
  选收款人 → 分数 + 备注；实时总分榜、按局流水；
  **撤销需双方确认**：发起后分数冻结、另一方「同意 / 拒绝」，双方同意才回滚，
  撤销记录永久留痕（划线 + 已撤销徽章，历史复盘同步展示）
- 🎛️ **玩法开关**：记分 / 条件卡可单独关闭（至少开一项），下一局随时可进、无前置门槛；
  房主顶栏常驻「下一局」（二次确认防误触）
- 📊 **战绩**（仅登录用户可见，流水含隐私备注）：结束战局自动归档（含战局中离场者）；历史列表、
  复盘详情（每轮条件卡 + 每笔流水含撤销状态）、玩家累计盈亏/场次/胜场统计、**个人盈亏走势图**（累计折线）；
  战局支持 **📤 导出 CSV**（Excel 可直接打开）与 **🖼️ 一键生成分享图**（最终排名卡片 PNG）
- 🛠️ **管理后台**：`/admin` 口令登录（入口仅对本机登录过后台的设备显示），数据大盘（用户/战局/记账/抽卡总量 +
  近 7 日曲线 + 盈亏榜）+ 用户管理（搜索/改名/重置密码/删除）+ 页脚设置（GitHub 链接与自定义文字，留空隐藏）；
  已适配移动端
- 📱 **响应式 + PWA**：手机（吸顶比分条 + 底部标签）/ 平板双栏 / 桌面三栏中控台；
  手机浏览器「添加到主屏幕」后以独立 App 打开（manifest + 图标，无需应用商店）；
  Service Worker 离线缓存页面壳与静态资源，弱网/断网不再白屏，二次打开秒开

## 技术栈

| 层 | 技术 |
|---|---|
| 后端 | Node.js 22 + TypeScript + Express + Socket.IO + better-sqlite3（SQLite 单文件）|
| 前端 | React 18 + Vite + TypeScript + Tailwind CSS v4 |
| 部署 | Docker 多阶段构建，单容器单端口；数据挂载 `/data` 卷 |

架构：服务端为唯一权威状态，任何变更向房间内全员广播带递增序号（rev）的个性化快照；
记账/发牌/战局实时写入 SQLite，进行中房间防抖落盘快照，容器重启后无缝恢复。

## 快速开始（开发）

```bash
docker compose -f docker-compose.dev.yml up --build
```

- 网页：http://localhost:5173 （手机同局域网访问 `http://<电脑IP>:5173`）
- API：http://localhost:3000/api/health
- 热更新已开启（源码 bind mount + 轮询）；`node_modules` 在命名卷内，不污染宿主机

装新依赖（示例）：

```bash
docker compose -f docker-compose.dev.yml run --rm server npm i <pkg> --registry=https://registry.npmmirror.com
docker compose -f docker-compose.dev.yml run --rm web npm i <pkg> --registry=https://registry.npmmirror.com
```

## 测试（全部容器内）

```bash
# 冒烟测试：4 个模拟客户端完整打一场 + 观战模式（90 项断言）
docker compose -f docker-compose.dev.yml run --rm server node test/smoke.mjs

# 安全测试：未授权/越权/输入校验/单点登录/限流/响应头（45 项）
docker compose -f docker-compose.dev.yml run --rm server node test/sec.mjs
# 测试请求自动携带限流豁免头（仅 ALLOW_TEST_CAPTCHA=1 的环境生效），
# smoke 与 sec 可以连续运行互不污染，无需重启容器

# 持久化验证：开局记账 → 重启容器 → 会话恢复 + 历史完整
OUT=$(docker compose -f docker-compose.dev.yml exec -T server node /app/test/persist.mjs setup)
docker compose -f docker-compose.dev.yml restart server && sleep 12
# 用 setup 输出的 code/token（等健康检查通过后）：
docker compose -f docker-compose.dev.yml exec -T server node /app/test/persist.mjs verify <code> <token>
```

以上三步（+ lint、前端构建）已由 GitHub Actions 在每次 push/PR 自动执行。

E2E 可视化验证（无头 Chromium 双手机 + 平板/桌面三档，输出 15 张截图到 `.test-artifacts/`）：

```bash
docker exec mahjong-score-web-1 sh -c \
  "apt-get install -y -qq chromium fonts-noto-cjk fonts-noto-color-emoji fonts-symbola \
   && mkdir -p /pptr && cd /pptr && npm i puppeteer-core --registry=https://registry.npmmirror.com \
   && cp /out/e2e.mjs . && node e2e.mjs"
```

## 生产部署（云服务器）

### 1. 直接跑

```bash
# 服务器上安装 Docker 后，把项目传上去，然后：
docker compose up -d --build
```

- 默认监听 `3000` 端口（可用 `docker-compose.yml` 里的 ports 映射修改）
- **管理后台** `http://你的域名/admin`，口令由环境变量 `ADMIN_TOKEN` 控制（默认 `admin123`，生产务必修改：
  在 `docker-compose.yml` 的 mahjong 服务下加 `environment: [ADMIN_TOKEN=你的口令]`）
- 后台可维护：用户（改名/重置密码/删除）与页脚内容（GitHub 链接、自定义文字）
- 环境变量 `ALLOW_TEST_CAPTCHA=1` 可跳过图形验证码校验（仅供自动化测试使用，生产切勿开启）
- 国内服务器构建慢时可指定镜像源：`docker compose build --build-arg NPM_REGISTRY=https://registry.npmmirror.com`
- 数据保存在 named volume `mahjong_data`（`/data/mahjong.db`）。**定时备份**（在线快照，WAL 安全，保留最近 7 份）：

  ```bash
  sh scripts/backup-db.sh /var/backups/mahjong   # 手动跑一次
  # crontab -e 加入（每天凌晨 4 点备份）：
  # 0 4 * * * cd /path/to/Li-Mahjong && sh scripts/backup-db.sh /var/backups/mahjong >> /var/log/mahjong-backup.log 2>&1
  ```

### 2. Nginx 反向代理（含 WebSocket）

```nginx
server {
    listen 80;
    server_name your.domain.com;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;      # WebSocket 升级
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_read_timeout 300s;
    }
}
```

HTTPS 用 certbot 一条命令：`certbot --nginx -d your.domain.com`。
不配域名也可以：云服务器安全组放行 3000 端口，直接 `http://服务器IP:3000` 访问。

### 3. 更新

```bash
git pull   # 或重新上传代码
docker compose up -d --build
```

数据在卷里，重建容器不丢。

## 目录结构

```
├─ Dockerfile              # 生产镜像（多阶段：build web+server → 运行）
├─ Dockerfile.dev          # 开发基础镜像（含 better-sqlite3 编译工具链）
├─ docker-compose.yml      # 生产：单服务 + 数据卷 + restart: unless-stopped
├─ docker-compose.dev.yml  # 开发：server(tsx watch) + web(vite 热更)
├─ .github/workflows/ci.yml # CI：lint + 冒烟 + 安全 + 前端构建 + 持久化
├─ scripts/backup-db.sh    # 数据库在线备份脚本（cron 友好，保留最近 7 份）
├─ server/
│  ├─ src/{index,rooms,db,types}.ts
│  ├─ data/builtin-conditions.json   # 内置题库 73 张
│  └─ test/{smoke,sec,persist}.mjs
├─ web/                    # React + Vite + Tailwind v4（public/ 内含 PWA manifest、图标与 Service Worker）
└─ .test-artifacts/        # E2E 截图与脚本
```

## 代码规范

ESLint（server + web 各自 flat config）与 Prettier（`.prettierrc`）已配置：

```bash
docker compose -f docker-compose.dev.yml run --rm server npm run lint
docker compose -f docker-compose.dev.yml run --rm web npm run lint
# 格式化（会改动文件，提交前按需执行）
docker compose -f docker-compose.dev.yml run --rm server npm run format
docker compose -f docker-compose.dev.yml run --rm web npm run format
```

## 开源协议

本项目基于 [MIT License](./LICENSE) 开源，版权归 **黎智锋** 所有。

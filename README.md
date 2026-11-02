# 雀记 · 在线麻将记分 + 整蛊条件卡

四人麻将牌桌的实时记分网页：一人建房，其他人扫码/输房间码加入，各用自己手机实时看总分；
每局开始自动给每人发一张「整蛊条件卡」（内置 73 张题库，源自经典牌桌纸条），支持自定义题库；
手动记账流水、撤销、历史战局复盘与累计盈亏统计。

**全流程 Docker 化**：开发、测试、生产都在容器内运行，宿主机只需安装 Docker。

## 功能

- 🏠 **房间**：创建/加入（4 位房间码 + 二维码扫码直达）、**标准四人局（东南西北）**、方位自选（被占置灰）、
  踢人、解散、断线自动重连
- 🪪 **用户身份**：每台设备生成永久 uid，昵称自动带出、首页「欢迎回来」展示生涯战绩；
  改名不丢历史，同 uid 重复加入自动回合同一玩家
- 🀫 **条件卡**：每局一键发牌、翻卡动画、仅自己可见/亮牌给全场、房主可对任意玩家「重摸 / 作废」、
  全员重摸（纸条作废）、「一晚限一次」卡自动去重
- 📚 **题库**：内置 73 张（出牌声音 / 动作惩罚 / 胡牌限制 / 行为限制 / 情报换牌 / 全场效果 6 类），
  按分类或单卡启停，自定义增删改（全局共享）
- 💰 **记分**：付款人可多选（自动均分）→ 收款人 → 分数 + 备注；实时总分榜、按局流水、逐笔撤销、重置分数
- 🎛️ **玩法开关**：记分 / 条件卡可单独关闭（至少开一项），下一局随时可进、无前置门槛
- 📊 **战绩**：结束战局自动归档；历史列表、复盘详情（每轮条件卡 + 每笔流水）、玩家累计盈亏/场次/胜场统计
- 🛠️ **管理后台**：`/admin` 口令登录，数据大盘（用户/战局/记账/抽卡总量 + 近 7 日曲线 + 盈亏榜）+
  用户管理（搜索/改名/删除）
- 📱 **响应式**：手机（吸顶比分条 + 底部标签）/ 平板双栏 / 桌面三栏中控台（适合平板横屏放桌面中间）

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
# 冒烟测试：4 个模拟客户端完整打一场（37 项断言）
docker compose -f docker-compose.dev.yml run --rm server node test/smoke.mjs

# 持久化验证：开局记账 → 重启容器 → 会话恢复 + 历史完整
docker exec mahjong-score-server-1 node /app/test/persist.mjs setup
docker restart mahjong-score-server-1 && sleep 6
# 用 setup 输出的 code/token：
docker exec mahjong-score-server-1 node /app/test/persist.mjs verify <code> <token>
```

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
- 国内服务器构建慢时可指定镜像源：`docker compose build --build-arg NPM_REGISTRY=https://registry.npmmirror.com`
- 数据保存在 named volume `mahjong_data`（`/data/mahjong.db`），备份即备份该卷：
  `docker run --rm -v mahjong-score_mahjong_data:/data -v $(pwd):/backup alpine cp /data/mahjong.db /backup/`

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
├─ server/
│  ├─ src/{index,rooms,db,types}.ts
│  ├─ data/builtin-conditions.json   # 内置题库 73 张
│  └─ test/{smoke,persist}.mjs
├─ web/                    # React + Vite + Tailwind v4
└─ .test-artifacts/        # E2E 截图与脚本
```

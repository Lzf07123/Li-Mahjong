#!/bin/sh
# 雀记数据备份：在线快照 SQLite（WAL 安全）→ 复制到宿主机目录，保留最近 KEEP 份
# 用法：sh scripts/backup-db.sh [备份目录]   （cron 定时示例见 README）
# 环境变量：CONTAINER=容器名（默认 mahjong-score）  KEEP=保留份数（默认 7）
set -e

CONTAINER=${CONTAINER:-mahjong-score}
DEST=${1:-./backups}
KEEP=${KEEP:-7}

TS=$(date +%Y%m%d-%H%M%S)
mkdir -p "$DEST"

# 用 better-sqlite3 的 backup API 在线快照：WAL 模式下直接 cp 数据文件可能拷到写一半的状态，
# backup API 输出的是一致性完整快照，备份期间不阻塞线上读写
docker exec "$CONTAINER" node -e "
  const db = require('better-sqlite3')('/data/mahjong.db', { readonly: true });
  db.backup('/data/.backup-tmp.db')
    .then(() => { console.log('snapshot ok'); process.exit(0); })
    .catch((e) => { console.error(e); process.exit(1); });
"
docker cp "$CONTAINER:/data/.backup-tmp.db" "$DEST/mahjong-$TS.db"
docker exec "$CONTAINER" rm -f /data/.backup-tmp.db

# 只保留最近 KEEP 份
ls -1t "$DEST"/mahjong-*.db 2>/dev/null | tail -n +$((KEEP + 1)) | while read -r f; do rm -f "$f"; done
echo "✅ 已备份到 $DEST/mahjong-$TS.db（保留最近 $KEEP 份）"

import type { HistoryDetailData } from '../types';

const FONT = '"PingFang SC","Microsoft YaHei","Noto Sans CJK SC",system-ui,sans-serif';
const GOLD = '#d9a441';
const FELT_950 = '#06231a';
const FELT_900 = '#0b3d2e';
const FELT_800 = '#0f4f3a';

function scorePaint(v: number): string {
  return v > 0 ? '#6ee7b7' : v < 0 ? '#fca5a5' : 'rgba(255,255,255,0.7)';
}

function roundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** 用 canvas 生成战局分享图（最终排名卡）并触发下载 PNG */
export function downloadHistoryShareImage(data: HistoryDetailData): void {
  const sorted = [...data.players].sort((a, b) => b.finalScore - a.finalScore);
  const scale = 2;
  const W = 760;
  const rowH = 62;
  const rowsTop = 186;
  const H = rowsTop + sorted.length * rowH + 88;

  const canvas = document.createElement('canvas');
  canvas.width = W * scale;
  canvas.height = H * scale;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('画布不可用');
  ctx.scale(scale, scale);

  // 背景竖渐变（与站点主题一致）
  const bg = ctx.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, FELT_800);
  bg.addColorStop(0.55, FELT_900);
  bg.addColorStop(1, FELT_950);
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);
  // 金色内框
  ctx.strokeStyle = 'rgba(217,164,65,0.4)';
  ctx.lineWidth = 1.5;
  ctx.strokeRect(14, 14, W - 28, H - 28);

  ctx.textBaseline = 'middle';
  // 标题与房间信息
  ctx.textAlign = 'center';
  ctx.fillStyle = GOLD;
  ctx.font = `900 38px ${FONT}`;
  ctx.fillText('雀记 · 战局复盘', W / 2, 66);
  ctx.fillStyle = 'rgba(255,255,255,0.6)';
  ctx.font = `500 15px ${FONT}`;
  const when = new Date(data.endedAt ?? data.startedAt).toLocaleString('zh-CN', { hour12: false });
  ctx.fillText(`房间 ${data.code} · ${when}${data.status !== 'finished' ? ' · 未打完' : ''}`, W / 2, 106);

  // 排名区标题
  ctx.textAlign = 'left';
  ctx.fillStyle = 'rgba(255,255,255,0.45)';
  ctx.font = `700 13px ${FONT}`;
  ctx.fillText('最 终 排 名', 34, 152);

  // 每一行：奖牌 + 方位 + 昵称 + 分数
  sorted.forEach((p, i) => {
    const y = rowsTop + i * rowH;
    roundedRect(ctx, 30, y, W - 60, rowH - 12, 14);
    ctx.fillStyle = i === 0 ? 'rgba(217,164,65,0.14)' : 'rgba(255,255,255,0.06)';
    ctx.fill();
    ctx.strokeStyle = i === 0 ? 'rgba(217,164,65,0.55)' : 'rgba(255,255,255,0.12)';
    ctx.lineWidth = 1.2;
    ctx.stroke();

    // 方位牌
    roundedRect(ctx, 50, y + 10, 34, 34, 8);
    ctx.fillStyle = '#1d7a5a';
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.font = `800 17px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.fillText(p.seat || '·', 67, y + 28);

    // 奖牌 + 昵称
    ctx.textAlign = 'left';
    ctx.font = `600 20px ${FONT}`;
    ctx.fillText(['🥇', '🥈', '🥉'][i] ?? `${i + 1}.`, 96, y + 27);
    ctx.fillStyle = '#ffffff';
    ctx.font = `800 20px ${FONT}`;
    ctx.fillText(p.name, 140, y + 27);

    // 分数
    ctx.textAlign = 'right';
    ctx.fillStyle = scorePaint(p.finalScore);
    ctx.font = `900 24px ${FONT}`;
    const s = p.finalScore;
    ctx.fillText(`${s > 0 ? '+' : ''}${s}`, W - 50, y + 27);
  });

  // 底部署名
  ctx.textAlign = 'center';
  ctx.fillStyle = 'rgba(255,255,255,0.4)';
  ctx.font = `500 13px ${FONT}`;
  ctx.fillText('🀄 由「雀记」生成 · 麻将记分与整蛊条件卡', W / 2, H - 42);

  canvas.toBlob((blob) => {
    if (!blob) throw new Error('分享图生成失败');
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `雀记战局-${data.code}.png`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }, 'image/png');
}

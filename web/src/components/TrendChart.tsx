import type { TrendPoint } from '../types';
import { scoreColor } from './common';

/**
 * 个人盈亏走势图：每局净分累加成折线，纯 SVG 无依赖。
 * 零轴以下为亏损区域（红色系），以上为盈利（金色）。
 */
export function TrendChart({ points }: { points: TrendPoint[] }) {
  const cum: number[] = [];
  let acc = 0;
  for (const p of points) {
    acc += p.score;
    cum.push(acc);
  }
  const W = 320;
  const H = 108;
  const padX = 8;
  const padT = 16;
  const padB = 24;
  const n = cum.length;
  const min = Math.min(0, ...cum);
  const max = Math.max(0, ...cum);
  const span = max - min || 1;
  const x = (i: number) => padX + (i * (W - padX * 2)) / Math.max(n - 1, 1);
  const y = (v: number) => padT + ((max - v) / span) * (H - padT - padB);
  const line = cum.map((v, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  const zeroY = y(0);
  // 收官点上下取整轴，画出盈/亏面积
  const area = `${line} L${x(n - 1).toFixed(1)},${zeroY.toFixed(1)} L${x(0).toFixed(1)},${zeroY.toFixed(1)} Z`;

  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label="盈亏走势图">
        <defs>
          <linearGradient id="trend-pos" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#d9a441" stopOpacity="0.35" />
            <stop offset="100%" stopColor="#d9a441" stopOpacity="0.02" />
          </linearGradient>
          <linearGradient id="trend-neg" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#f87171" stopOpacity="0.05" />
            <stop offset="100%" stopColor="#f87171" stopOpacity="0.3" />
          </linearGradient>
        </defs>
        {/* 零轴 */}
        <line x1={padX} y1={zeroY} x2={W - padX} y2={zeroY} stroke="rgba(255,255,255,0.25)" strokeDasharray="4 4" strokeWidth="1" />
        {/* 面积（最后一点的值决定盈亏方向） */}
        <path d={area} fill={cum[n - 1] >= 0 ? 'url(#trend-pos)' : 'url(#trend-neg)'} />
        <path d={line} fill="none" stroke="#d9a441" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
        {/* 起止点 */}
        {n > 1 && <circle cx={x(0)} cy={y(cum[0])} r="3" fill="#d9a441" fillOpacity="0.5" />}
        <circle cx={x(n - 1)} cy={y(cum[n - 1])} r="4" fill="#d9a441" stroke="#06231a" strokeWidth="1.5" />
        {/* 场次标注 */}
        <text x={padX} y={H - 6} fontSize="10" fill="rgba(255,255,255,0.4)">
          {points[0] && new Date(points[0].startedAt).toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' })}
        </text>
        <text x={W - padX} y={H - 6} fontSize="10" fill="rgba(255,255,255,0.4)" textAnchor="end">
          {points[n - 1] && new Date(points[n - 1].startedAt).toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' })}
          {' · '}
          {n} 场
        </text>
      </svg>
      <p className="mt-1 text-center text-xs">
        累计盈亏{' '}
        <b className={`num text-base font-black ${scoreColor(acc)}`}>
          {acc > 0 ? '+' : ''}
          {acc}
        </b>
      </p>
    </div>
  );
}

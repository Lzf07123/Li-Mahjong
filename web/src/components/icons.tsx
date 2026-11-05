import type { ReactNode, SVGProps } from 'react'

/**
 * 统一线性 SVG 图标集（替代结构性 emoji）：
 * 24 viewBox / stroke 1.8 / round cap，颜色随 currentColor，尺寸由 size 控制。
 * 装饰性 emoji（背景漂浮牌、toast 文案）不在此列。
 */
export type IconProps = SVGProps<SVGSVGElement> & { size?: number }

function Svg({ size = 20, children, ...rest }: IconProps & { children: ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="shrink-0"
      {...rest}
    >
      {children}
    </svg>
  )
}

/* ---------- 麻将 / 牌 ---------- */

/** 条件卡（竖牌 + 内衬） */
export function IconTile(p: IconProps) {
  return (
    <Svg {...p}>
      <rect x="5.5" y="3" width="13" height="18" rx="3" />
      <rect x="8.75" y="6.25" width="6.5" height="11.5" rx="1.5" opacity="0.5" />
    </Svg>
  )
}

/** 牌背（未亮出） */
export function IconTileBack(p: IconProps) {
  return (
    <Svg {...p}>
      <rect x="5.5" y="3" width="13" height="18" rx="3" />
      <path d="M9 8.5 15 15.5M15 8.5 9 15.5" opacity="0.7" />
    </Svg>
  )
}

/** 骰子（开局 / 创建房间） */
export function IconDice(p: IconProps) {
  return (
    <Svg {...p}>
      <rect x="3.5" y="3.5" width="17" height="17" rx="4" />
      <circle cx="8.4" cy="8.4" r="1.1" fill="currentColor" stroke="none" />
      <circle cx="15.6" cy="8.4" r="1.1" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="1.1" fill="currentColor" stroke="none" />
      <circle cx="8.4" cy="15.6" r="1.1" fill="currentColor" stroke="none" />
      <circle cx="15.6" cy="15.6" r="1.1" fill="currentColor" stroke="none" />
    </Svg>
  )
}

/* ---------- 记分 / 数据 ---------- */

/** 银两（记分） */
export function IconCoin(p: IconProps) {
  return (
    <Svg {...p}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M8.5 7.5 12 12l3.5-4.5" />
      <path d="M12 12v6" />
      <path d="M9.5 14.5h5" />
    </Svg>
  )
}

/** 流水账本 */
export function IconScroll(p: IconProps) {
  return (
    <Svg {...p}>
      <rect x="5" y="3.5" width="14" height="17" rx="2.5" />
      <path d="M9 8.5h6M9 12h6M9 15.5h4" />
    </Svg>
  )
}

/** 图表 */
export function IconChart(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M3.5 3.5v15a2 2 0 0 0 2 2h15" />
      <path d="M8 16.5V11M12.5 16.5V7M17 16.5v-3.5" />
    </Svg>
  )
}

/** 奖杯 */
export function IconTrophy(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M8 21h8" />
      <path d="M12 17.5V21" />
      <path d="M7 4h10v6.5a5 5 0 0 1-10 0Z" />
      <path d="M7 6H4.5A1.5 1.5 0 0 0 3 7.5C3 9.5 4.6 11 6.6 11H7" />
      <path d="M17 6h2.5A1.5 1.5 0 0 1 21 7.5C21 9.5 19.4 11 17.4 11H17" />
    </Svg>
  )
}

/** 导出 / 下载 */
export function IconExport(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M12 3.5V14" />
      <path d="m7.5 10 4.5 4.5L16.5 10" />
      <path d="M4.5 19.5h15" />
    </Svg>
  )
}

/** 图片 */
export function IconImage(p: IconProps) {
  return (
    <Svg {...p}>
      <rect x="3.5" y="4.5" width="17" height="15" rx="2.5" />
      <circle cx="9" cy="10" r="1.6" />
      <path d="m20.5 15.5-4.5-4.5L7.5 19.5" />
    </Svg>
  )
}

/* ---------- 动作 / 状态 ---------- */

/** 房主 / 领先 */
export function IconCrown(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M3.5 8.5 7 12l5-6.5 5 6.5 3.5-3.5V17a1.5 1.5 0 0 1-1.5 1.5H5A1.5 1.5 0 0 1 3.5 17Z" />
    </Svg>
  )
}

/** 亮牌 / 宣布 */
export function IconMegaphone(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="m3 11 18-6v14L3 14v-3Z" />
      <path d="M11.6 16.8a3 3 0 1 1-5.8-1.6" />
    </Svg>
  )
}

/** 仅自己可见 */
export function IconLock(p: IconProps) {
  return (
    <Svg {...p}>
      <rect x="4.5" y="10.5" width="15" height="10" rx="2.5" />
      <path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" />
    </Svg>
  )
}

/** 观战 */
export function IconEye(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z" />
      <circle cx="12" cy="12" r="3" />
    </Svg>
  )
}

/** 重摸 / 重置 */
export function IconRefresh(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M21 12a9 9 0 1 1-9-9c2.5 0 4.9 1 6.7 2.7L21 8" />
      <path d="M21 3v5h-5" />
    </Svg>
  )
}

/** 设置 */
export function IconGear(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2Z" />
      <circle cx="12" cy="12" r="3" />
    </Svg>
  )
}

/** 复制 */
export function IconCopy(p: IconProps) {
  return (
    <Svg {...p}>
      <rect x="8.5" y="8.5" width="12" height="12" rx="2" />
      <path d="M4.5 15.5h-.5a2 2 0 0 1-2-2v-9a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v.5" />
    </Svg>
  )
}

/** 二维码 */
export function IconQr(p: IconProps) {
  return (
    <Svg {...p}>
      <rect x="3.5" y="3.5" width="6" height="6" rx="1.2" />
      <rect x="14.5" y="3.5" width="6" height="6" rx="1.2" />
      <rect x="3.5" y="14.5" width="6" height="6" rx="1.2" />
      <path d="M14.5 14.5h2.5v2.5h-2.5Z" />
      <path d="M20.5 14.5v.01M20.5 20.5v.01M14.5 20.5v.01" />
    </Svg>
  )
}

/** 离开 / 退出登录 */
export function IconDoor(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <path d="m16 17 5-5-5-5" />
      <path d="M21 12H9" />
    </Svg>
  )
}

/** 笔（记一笔 / 自定义） */
export function IconPen(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </Svg>
  )
}

/** 题库 */
export function IconBooks(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
      <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2Z" />
    </Svg>
  )
}

/** 结束战局 */
export function IconFlag(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1Z" />
      <path d="M4 22v-7" />
    </Svg>
  )
}

/** 解散（危险） */
export function IconTrash(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M4 7h16" />
      <path d="M9.5 7V5A1.5 1.5 0 0 1 11 3.5h2A1.5 1.5 0 0 1 14.5 5v2" />
      <path d="m6.5 7 .9 12a2 2 0 0 0 2 1.9h5.2a2 2 0 0 0 2-1.9l.9-12" />
      <path d="M10 11v6M14 11v6" />
    </Svg>
  )
}

/** 账号设置 */
export function IconIdCard(p: IconProps) {
  return (
    <Svg {...p}>
      <rect x="3" y="5" width="18" height="14" rx="2.5" />
      <circle cx="8.5" cy="10.5" r="2" />
      <path d="M5.5 16c.7-1.5 1.8-2.2 3-2.2s2.3.7 3 2.2" />
      <path d="M14 9.5h4.5M14 13h3" />
    </Svg>
  )
}

/** 关闭 */
export function IconClose(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M6 6l12 12M18 6 6 18" />
    </Svg>
  )
}

/** 用户群 */
export function IconUsers(p: IconProps) {
  return (
    <Svg {...p}>
      <circle cx="9" cy="8" r="3.5" />
      <path d="M2.5 20c.8-3.2 3.4-5 6.5-5s5.7 1.8 6.5 5" />
      <path d="M16.5 5a3.2 3.2 0 0 1 0 6" />
      <path d="M18.5 15.4c1.7.7 2.7 2.1 3 4.6" />
    </Svg>
  )
}

/** 确认 */
export function IconCheck(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="m4.5 12.5 5 5L19.5 7" />
    </Svg>
  )
}

/* ---------- 条件卡分类 ---------- */

/** 出牌声音整蛊 */
export function IconSpeaker(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M11 5 6 9H3v6h3l5 4V5Z" />
      <path d="M15.5 8.5a5 5 0 0 1 0 7" />
      <path d="M18.5 5.5a9 9 0 0 1 0 13" />
    </Svg>
  )
}

/** 动作惩罚 */
export function IconZap(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M13 2 4 14h7l-1 8 9-12h-7l1-8Z" />
    </Svg>
  )
}

/** 胡牌限制 */
export function IconTarget(p: IconProps) {
  return (
    <Svg {...p}>
      <circle cx="12" cy="12" r="8.5" />
      <circle cx="12" cy="12" r="3.5" />
      <path d="M12 2v3M12 19v3M2 12h3M19 12h3" opacity="0.7" />
    </Svg>
  )
}

/** 行为限制 */
export function IconBan(p: IconProps) {
  return (
    <Svg {...p}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="m6 6 12 12" />
    </Svg>
  )
}

/** 情报与换牌 */
export function IconSwap(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M16.5 3.5H21V8" />
      <path d="M21 3.5 14 10.5" />
      <path d="M7.5 20.5H3V16" />
      <path d="M3 20.5l7-7" />
    </Svg>
  )
}

/** 全场效果 */
export function IconGlobe(p: IconProps) {
  return (
    <Svg {...p}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M3.5 12h17" />
      <path d="M12 3.5c2.7 2.3 4 5.2 4 8.5s-1.3 6.2-4 8.5c-2.7-2.3-4-5.2-4-8.5s1.3-6.2 4-8.5Z" />
    </Svg>
  )
}

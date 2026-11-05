import type { ComponentType, ReactNode } from 'react'
import type { Category, PlayerView } from '../types'
import {
  IconBan,
  IconCrown,
  IconGlobe,
  IconSpeaker,
  IconSwap,
  IconTarget,
  IconZap,
  type IconProps,
} from './icons'

export const SEATS = ['东', '南', '西', '北']

export const SEAT_COLORS: Record<string, string> = {
  东: 'bg-rose-500 text-white',
  南: 'bg-emerald-500 text-white',
  西: 'bg-amber-500 text-white',
  北: 'bg-sky-500 text-white',
  中: 'bg-red-600 text-white',
  发: 'bg-green-600 text-white',
  白: 'bg-stone-400 text-white',
  春: 'bg-pink-400 text-white',
}

export const CATEGORY_META: Record<
  Category,
  { name: string; icon: ComponentType<IconProps>; chip: string }
> = {
  voice: {
    name: '出牌整蛊',
    icon: IconSpeaker,
    chip: 'bg-orange-900/60 text-orange-200 border-orange-400/30',
  },
  action: {
    name: '动作惩罚',
    icon: IconZap,
    chip: 'bg-rose-900/60 text-rose-200 border-rose-400/30',
  },
  hu: { name: '胡牌限制', icon: IconTarget, chip: 'bg-sky-900/60 text-sky-200 border-sky-400/30' },
  rule: {
    name: '行为限制',
    icon: IconBan,
    chip: 'bg-violet-900/60 text-violet-200 border-violet-400/30',
  },
  info: {
    name: '情报换牌',
    icon: IconSwap,
    chip: 'bg-teal-900/60 text-teal-200 border-teal-400/30',
  },
  global: {
    name: '全场效果',
    icon: IconGlobe,
    chip: 'bg-amber-900/60 text-amber-200 border-amber-400/30',
  },
}

export function SeatBadge({ seat, size = 'md' }: { seat: string; size?: 'md' | 'lg' }) {
  return (
    <span
      className={`seat-badge ${SEAT_COLORS[seat] ?? 'bg-felt-600 text-white'} ${
        size === 'lg' ? 'h-9 w-9 rounded-lg text-lg' : ''
      }`}
    >
      {seat}
    </span>
  )
}

export function CategoryChip({ category }: { category: Category | string | null }) {
  if (!category) return null
  const meta = CATEGORY_META[category as Category]
  if (!meta) return null
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold ${meta.chip}`}
    >
      <meta.icon size={13} />
      {meta.name}
    </span>
  )
}

export function Sheet({
  open,
  onClose,
  title,
  children,
  wide,
}: {
  open: boolean
  onClose: () => void
  title: ReactNode
  children: ReactNode
  wide?: boolean
}) {
  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center">
      <div
        className="absolute inset-0 animate-fade-in bg-black/65 backdrop-blur-[2px]"
        onClick={onClose}
      />
      <div
        className={`relative flex max-h-[88dvh] w-full animate-slide-up flex-col overflow-hidden rounded-t-3xl border border-white/10 bg-felt-950/95 shadow-2xl backdrop-blur-md sm:max-h-[85dvh] sm:rounded-3xl ${
          wide ? 'sm:max-w-2xl' : 'sm:max-w-md'
        }`}
      >
        <div className="flex items-center justify-between gap-2 border-b border-white/10 px-4 py-3">
          <h2 className="flex min-w-0 items-center gap-2 truncate text-base font-bold">{title}</h2>
          <button
            onClick={onClose}
            className="btn-ghost !min-h-[36px] !shrink-0 !rounded-full !px-3 !py-1 text-xs"
          >
            关闭
          </button>
        </div>
        <div className="overflow-y-auto overscroll-contain px-4 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-3">
          {children}
        </div>
      </div>
    </div>
  )
}

export function ConfirmButton({
  onConfirm,
  className,
  children,
  confirmText = '再点一次确认',
}: {
  onConfirm: () => void
  className?: string
  children: ReactNode
  confirmText?: string
}) {
  return (
    <button
      className={className}
      onClick={(e) => {
        const el = e.currentTarget
        if (el.dataset.armed === '1') {
          el.dataset.armed = ''
          onConfirm()
        } else {
          el.dataset.armed = '1'
          const original = el.textContent
          el.textContent = confirmText
          setTimeout(() => {
            if (el.isConnected && el.dataset.armed === '1') {
              el.dataset.armed = ''
              el.textContent = original
            }
          }, 2200)
        }
      }}
    >
      {children}
    </button>
  )
}

export function Avatar({ p, me }: { p: PlayerView; me: boolean }) {
  return (
    <span className="relative inline-flex">
      <SeatBadge seat={p.seat} />
      {p.isHost && (
        <span
          className="absolute -right-2 -top-2 rounded-full bg-felt-950/80 p-0.5 leading-none"
          title="房主"
        >
          <IconCrown size={12} className="text-gold" />
        </span>
      )}
      {me && (
        <span className="absolute -bottom-1.5 left-1/2 -translate-x-1/2 rounded-full bg-gold px-1 text-[8px] font-bold leading-tight text-black">
          我
        </span>
      )}
    </span>
  )
}

/** 发牌 ack 中「题库不足未发卡」人数的提示后缀（missing 为 0/缺省时返回空串） */
export function dealMissingSuffix(resp: Record<string, unknown> | undefined | null): string {
  const n = Number(resp?.missing ?? 0)
  return n > 0 ? `（题库不足，${n} 人本轮未发卡）` : ''
}

export function fmtTime(ts: number): string {
  return new Date(ts).toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

/** 相对时间：刚刚 / N 分钟前 / N 小时前 / 昨天 / MM-DD */
export function fmtRel(ts: number): string {
  const diff = Date.now() - ts
  if (diff < 60e3) return '刚刚'
  if (diff < 3600e3) return `${Math.floor(diff / 60e3)} 分钟前`
  if (diff < 86400e3) return `${Math.floor(diff / 3600e3)} 小时前`
  if (diff < 2 * 86400e3) return '昨天'
  return new Date(ts).toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' })
}

export function scoreColor(n: number): string {
  return n > 0 ? 'text-emerald-300' : n < 0 ? 'text-red-300' : 'text-white/70'
}

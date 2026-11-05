import { useEffect, useState } from 'react'
import type { PlayerView, Snapshot } from '../types'
import { CATEGORY_META, CategoryChip, SeatBadge } from './common'
import { IconLock, IconMegaphone, IconTile, IconTileBack } from './icons'
import { emitAck } from '../socket'

// ---------- 我的条件卡 ----------
export function MyCard({ me, isHost }: { me: PlayerView | undefined; isHost: boolean }) {
  const meta = me?.cardCategory ? CATEGORY_META[me.cardCategory] : null
  if (!me?.cardText) {
    // 空状态：两张倾斜牌背垫底，纸卡浮在上层等发牌
    return (
      <div className="relative min-h-[210px]">
        <div className="paper-card-back absolute left-1/2 top-5 h-44 w-32 -translate-x-[88%] -rotate-12 rounded-2xl opacity-70" />
        <div className="paper-card-back absolute left-1/2 top-3 h-44 w-32 -translate-x-[12%] rotate-[10deg] rounded-2xl opacity-70" />
        <div className="paper-card relative flex min-h-[210px] flex-col items-center justify-center rounded-2xl p-6 text-center">
          <span className="animate-float-slow flex h-16 w-12 items-center justify-center rounded-xl border border-stone-900/15 bg-stone-900/[0.06] shadow-inner">
            <IconTileBack size={30} className="text-stone-500/70" />
          </span>
          <p className="mt-3 text-sm font-bold text-stone-500">等待发牌…</p>
          <p className="mt-1 text-xs text-stone-400">新一局开始后这里会出现你的条件卡</p>
        </div>
      </div>
    )
  }
  const Watermark = meta?.icon ?? IconTile
  return (
    <div>
      <div className="relative">
        {/* 底下垫一张牌背，持牌层次感 */}
        <div className="paper-card-back absolute inset-x-4 top-4 -bottom-1.5 rounded-2xl opacity-55" />
        <div
          className={`paper-card animate-pop relative overflow-hidden rounded-2xl p-5 text-stone-900 ${
            me.cardRevealed ? 'ring-2 ring-emerald-600/50' : ''
          }`}
        >
          {/* 分类图标大水印 */}
          <Watermark
            size={110}
            className="pointer-events-none absolute -right-3 -top-5 select-none rotate-12 opacity-[0.07]"
          />
          <div className="relative flex items-center justify-between gap-2">
            <span className="shrink-0 rounded-full bg-stone-900/10 px-2.5 py-1 text-[11px] font-bold text-stone-600">
              本局条件卡
            </span>
            {me.cardRevealed ? (
              <span className="flex items-center gap-1 rounded-full bg-emerald-600/15 px-2.5 py-1 text-[11px] font-bold text-emerald-700">
                <IconMegaphone size={12} /> 已亮牌 · 全场可见
              </span>
            ) : (
              <span className="flex items-center gap-1 rounded-full bg-amber-600/15 px-2.5 py-1 text-[11px] font-bold text-amber-700">
                <IconLock size={12} /> 仅自己可见
              </span>
            )}
          </div>
          <div className="relative mt-3.5">
            <CategoryChip category={me.cardCategory} />
          </div>
          <p className="relative mt-3 break-words text-xl font-black leading-relaxed sm:text-2xl">
            {me.cardText}
          </p>
          <div className="relative mt-4">
            {!me.cardRevealed ? (
              <button
                className="btn w-full gap-2 bg-stone-900/85 text-white hover:bg-stone-900"
                onClick={() => emitAck('game:reveal').catch(() => {})}
              >
                <IconMegaphone size={16} /> 亮牌给全场
              </button>
            ) : (
              <p className="text-center text-[11px] font-semibold text-emerald-700/80">
                本局已向全场亮出 · 尽情整蛊吧
              </p>
            )}
          </div>
        </div>
      </div>
      {isHost && (
        <p className="mt-2.5 text-center text-[11px] text-white/40">
          提示：管理菜单里可对任意玩家「重摸 / 作废」条件卡
        </p>
      )}
    </div>
  )
}

function CategoryChipDark({ category }: { category: string | null }) {
  if (!category) return null
  return <CategoryChip category={category} />
}

// ---------- 桌面条件卡墙 ----------
export function CardWall({ snap, myId }: { snap: Snapshot; myId: string | null }) {
  return (
    <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
      {snap.players.map((p) => {
        const mine = p.id === myId
        const visible = p.cardText !== null
        return (
          <div
            key={p.id}
            className={`paper-card relative min-h-[150px] rounded-xl p-3.5 text-stone-900 transition ${
              mine ? 'ring-2 ring-gold' : ''
            }`}
          >
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-1.5">
                <SeatBadge seat={p.seat} />
                <b className="max-w-[7em] truncate text-xs">{p.name}</b>
                {mine && <span className="text-[10px] font-bold text-amber-700">（我）</span>}
              </span>
              {p.cardRevealed && (
                <span className="text-[10px] font-bold text-emerald-700">已亮</span>
              )}
            </div>
            {visible ? (
              <p className="mt-2.5 break-words text-[13px] font-bold leading-snug">{p.cardText}</p>
            ) : p.hasCard ? (
              <div className="paper-card-back mt-2.5 flex h-[72px] flex-col items-center justify-center gap-1 rounded-lg">
                <IconTileBack size={20} className="text-gold/75" />
                <span className="text-[10px] font-bold tracking-[0.3em] text-white/55">未亮牌</span>
              </div>
            ) : (
              <p className="mt-4 text-center text-[11px] text-stone-400">暂无</p>
            )}
          </div>
        )
      })}
    </div>
  )
}

// ---------- 抽卡动画 ----------
// 真实 3D 翻牌：牌背旋转亮出正面，再一道扫光；避免旧版「翻完再 pop」的二段弹跳
export function DrawOverlay({
  cardText,
  category,
  roundNo,
  onClose,
}: {
  cardText: string
  category: string | null
  roundNo: number
  onClose: () => void
}) {
  const [revealed, setRevealed] = useState(false)
  useEffect(() => {
    setRevealed(false)
    const t = setTimeout(() => setRevealed(true), 900)
    return () => clearTimeout(t)
  }, [cardText])

  const meta = category ? CATEGORY_META[category as keyof typeof CATEGORY_META] : null
  const FrontIcon = meta?.icon ?? IconTile

  return (
    <div
      className="fixed inset-0 z-[80] flex animate-fade-in items-center justify-center bg-black/75 p-6 backdrop-blur-sm"
      onClick={onClose}
    >
      <div className="w-full max-w-sm text-center">
        <p className="mb-4 animate-slide-up text-sm font-bold tracking-widest text-gold">
          第 {roundNo} 局 · 抽到条件卡
        </p>
        <div className="[perspective:1200px]">
          <div
            className={`relative mx-auto max-w-sm [transform-style:preserve-3d] transition-transform duration-700 ease-[cubic-bezier(0.3,0.9,0.35,1)] ${
              revealed
                ? '[transform:rotateY(0deg)_scale(1)]'
                : '[transform:rotateY(180deg)_scale(0.92)]'
            }`}
          >
            {/* 正面：条件内容 */}
            <div className="paper-card relative overflow-hidden rounded-3xl p-7 text-stone-900 [backface-visibility:hidden]">
              {revealed && (
                <span className="pointer-events-none absolute inset-y-0 left-0 z-10 w-1/3 animate-card-shine bg-gradient-to-r from-transparent via-white/70 to-transparent" />
              )}
              <div className="mx-auto flex h-16 w-12 rotate-[-3deg] items-center justify-center rounded-xl border border-stone-900/15 bg-gradient-to-b from-white/90 to-stone-200/80 shadow-[inset_0_0_0_2px_rgba(255,255,255,0.5),0_4px_10px_rgba(0,0,0,0.15)]">
                <FrontIcon size={30} className="text-stone-700" />
              </div>
              <div className="mt-3 flex justify-center">
                <CategoryChipDark category={category} />
              </div>
              <p className="mt-4 break-words text-xl font-black leading-relaxed">{cardText}</p>
              <p className="mt-4 text-xs font-semibold text-stone-500">
                本局生效 · 抽到什么照做什么
              </p>
            </div>
            {/* 背面：麻将牌背 */}
            <div className="paper-card-back absolute inset-0 flex flex-col items-center justify-center gap-3 rounded-3xl [backface-visibility:hidden] [transform:rotateY(180deg)]">
              <span className="animate-float-slow drop-shadow-lg">
                <IconTileBack size={64} className="text-gold/80" />
              </span>
              <span className="text-xs font-bold tracking-[0.4em] text-gold/80">雀 记</span>
            </div>
          </div>
        </div>
        <p className="mt-5 animate-pulse text-xs text-white/60">
          {revealed ? '点击任意处关闭' : ''}
        </p>
      </div>
    </div>
  )
}

import { memo, useCallback } from 'react'
import type { ReactNode } from 'react'
import type { ScoreEntryView, Snapshot } from '../types'
import { emitAck } from '../socket'
import { useApp } from '../App'
import { ConfirmButton, fmtTime } from './common'
import { IconScroll } from './icons'

export function Ledger({
  snap,
  myId,
  isHost,
}: {
  snap: Snapshot
  myId: string | null
  isHost: boolean
}) {
  const { toast } = useApp()
  const entries = snap.entries

  const act = useCallback(
    async (entryId: number, okMsg: (state?: string) => string, reject = false) => {
      try {
        const r = await emitAck('score:undo', { entryId, reject })
        toast(okMsg(r.state as string | undefined), 'success')
      } catch (e) {
        toast((e as Error).message, 'error')
      }
    },
    [toast],
  )

  if (entries.length === 0) {
    return (
      <div className="panel p-4">
        <h3 className="mb-2 flex items-center gap-2 text-sm font-bold text-white/85">
          <IconScroll size={16} className="text-gold" /> 记分流水
        </h3>
        <p className="py-6 text-center text-xs text-white/40">还没有记账 · 用记分表单记第一笔</p>
      </div>
    )
  }

  // 按局分组（entries 已按时间倒序；Map 分组 O(n)，比每条 find 扫描快一个数量级）
  const groups = new Map<number, typeof entries>()
  for (const e of entries) {
    const g = groups.get(e.roundNo)
    if (g) g.push(e)
    else groups.set(e.roundNo, [e])
  }

  return (
    <div className="panel p-4">
      <h3 className="mb-3 flex items-center justify-between text-sm font-bold text-white/85">
        <span className="flex items-center gap-2">
          <IconScroll size={16} className="text-gold" /> 记分流水
        </span>
        <span className="text-[11px] font-normal text-white/40">共 {snap.entryCount} 笔</span>
      </h3>
      <div className="space-y-3">
        {[...groups.entries()].map(([roundNo, items]) => (
          <div key={roundNo}>
            <div className="mb-1.5 flex items-center gap-2">
              <span className="rounded-md bg-felt-600/40 px-2 py-0.5 text-[11px] font-bold text-emerald-200">
                第 {roundNo} 局
              </span>
              <span className="h-px flex-1 bg-white/10" />
            </div>
            <div className="space-y-1.5">
              {items.map((e) => (
                <LedgerRow key={e.id} e={e} myId={myId} isHost={isHost} act={act} />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

const LedgerRow = memo(function LedgerRow({
  e,
  myId,
  isHost,
  act,
}: {
  e: ScoreEntryView
  myId: string | null
  isHost: boolean
  act: (entryId: number, okMsg: (state?: string) => string, reject?: boolean) => Promise<void>
}) {
  // 撤销相关方：付款方（记账人）与收款方；房主可代发起
  const isParty = !!myId && (e.createdBy === myId || e.toId === myId)
  const canRequest = isParty || isHost
  const iAmRequester = !!e.undo && e.undo.requestedBy === myId
  // 我已同意（含作为发起人自动计票）但撤销未执行
  const iConfirmed = !!e.undo && !!myId && e.undo.confirmed.includes(myId)
  // 我是尚未确认的一方，可以点「同意」
  const canConfirm = !!e.undo && isParty && !iConfirmed && !iAmRequester

  let action: ReactNode = null
  if (e.undone) {
    action = null
  } else if (e.undo) {
    action = iAmRequester ? (
      <button
        className="shrink-0 rounded-lg border border-white/15 px-2.5 py-1.5 text-[11px] font-semibold text-white/60 hover:bg-white/10"
        onClick={() => act(e.id, () => '已取消撤销请求')}
      >
        取消请求
      </button>
    ) : canConfirm ? (
      <div className="flex shrink-0 gap-1.5">
        <button
          className="rounded-lg border border-emerald-400/50 bg-emerald-500/20 px-2.5 py-1.5 text-[11px] font-bold text-emerald-100"
          onClick={() =>
            act(e.id, (s) => (s === 'awaiting' ? '已同意，等待另一方确认' : '已撤销该笔记录'))
          }
        >
          同意
        </button>
        <ConfirmButton
          className="rounded-lg border border-white/15 px-2.5 py-1.5 text-[11px] font-semibold text-white/60 hover:bg-white/10"
          confirmText="拒绝撤销？"
          onConfirm={() => act(e.id, () => '已拒绝，撤销请求作废', true)}
        >
          拒绝
        </ConfirmButton>
      </div>
    ) : null
  } else if (canRequest) {
    action = (
      <ConfirmButton
        className="shrink-0 rounded-lg border border-white/15 px-2.5 py-1.5 text-[11px] font-semibold text-white/60 hover:bg-white/10"
        confirmText="发起撤销？需对方同意"
        onConfirm={() => act(e.id, () => '撤销请求已发出，等待对方确认')}
      >
        撤销
      </ConfirmButton>
    )
  }

  return (
    <div
      className={`group flex items-center gap-2 rounded-xl border border-white/10 bg-black/20 px-3 py-2 ${
        e.undone ? 'opacity-45' : ''
      }`}
    >
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-1.5 text-[13px]">
          <span className={`font-semibold text-red-200 ${e.undone ? 'line-through' : ''}`}>
            {e.payers.map((p) => p.name).join('、')}
          </span>
          <span className="text-white/40">→</span>
          <span className={`font-semibold text-emerald-200 ${e.undone ? 'line-through' : ''}`}>
            {e.toName}
          </span>
          <span
            className={`ml-1 text-base font-black text-white ${e.undone ? 'line-through' : ''}`}
          >
            {e.amountTotal}
            {e.payers.length > 1 && (
              <span className="ml-1 text-[10px] font-normal text-white/45">
                （{e.payers.map((p) => `-${p.amount}`).join(' / ')}）
              </span>
            )}
          </span>
          {e.undone ? (
            <span className="rounded bg-white/15 px-1.5 py-0.5 text-[10px] font-bold text-white/60">
              已撤销
            </span>
          ) : e.undo ? (
            <span className="rounded bg-amber-400/20 px-1.5 py-0.5 text-[10px] font-bold text-amber-200">
              {iAmRequester ? '⏳ 等待对方确认' : canConfirm ? '待你确认' : '撤销申请中'}
            </span>
          ) : null}
        </div>
        <div className="mt-0.5 flex items-center gap-2 text-[10px] text-white/35">
          {e.note && (
            <span className="rounded bg-white/10 px-1.5 py-0.5 font-semibold text-white/60">
              {e.note}
            </span>
          )}
          <span>{fmtTime(e.undoneAt ?? e.createdAt)}</span>
        </div>
      </div>
      {action}
    </div>
  )
})

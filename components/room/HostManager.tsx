'use client'

import type { RoomUser } from '@/lib/roomTypes'

/**
 * Host-only panel: appoint or remove co-hosts and hand the room to someone else.
 * A co-host has the same powers as the host (pause, close, hammer, undo), so one
 * can carry on if the original host's phone dies.
 */
export default function HostManager({
  users,
  ownerUserId,
  onToggleCohost,
  onTransfer,
}: {
  users: RoomUser[]
  ownerUserId: string | null
  onToggleCohost: (user: RoomUser, on: boolean) => void
  onTransfer: (user: RoomUser) => void
}) {
  return (
    <details className="rounded-xl border border-slate-600 bg-slate-900/50 px-3 py-2">
      <summary className="cursor-pointer text-xs font-semibold text-slate-200">Hosts and co-hosts</summary>
      <p className="mt-2 text-[11px] text-slate-400">
        Co-hosts can pause, close, hammer and undo, so the auction can go on if the host drops out. Appoint at least
        one before you start.
      </p>
      <ul className="mt-2 space-y-1.5">
        {users.map((u) => {
          const isOwner = Boolean(ownerUserId) && u.user_id === ownerUserId
          const isCohost = Boolean(u.is_admin) && !isOwner
          return (
            <li key={u.id} className="flex flex-wrap items-center gap-2 text-xs">
              <span className="min-w-0 flex-1 truncate text-slate-100">{u.display_name}</span>
              {isOwner && (
                <span className="rounded bg-amber-500/20 px-2 py-0.5 text-[10px] font-bold uppercase text-amber-200">
                  Host
                </span>
              )}
              {isCohost && (
                <span className="rounded bg-sky-500/20 px-2 py-0.5 text-[10px] font-bold uppercase text-sky-200">
                  Co-host
                </span>
              )}
              {!isOwner && (
                <>
                  <button
                    type="button"
                    onClick={() => onToggleCohost(u, !isCohost)}
                    className="rounded-lg border border-slate-500 bg-slate-800 px-2.5 py-1 text-slate-200 hover:bg-slate-700"
                  >
                    {isCohost ? 'Remove co-host' : 'Make co-host'}
                  </button>
                  <button
                    type="button"
                    onClick={() => onTransfer(u)}
                    className="rounded-lg border border-amber-500/50 bg-amber-950/40 px-2.5 py-1 text-amber-200 hover:bg-amber-900/50"
                  >
                    Make host
                  </button>
                </>
              )}
            </li>
          )
        })}
      </ul>
    </details>
  )
}

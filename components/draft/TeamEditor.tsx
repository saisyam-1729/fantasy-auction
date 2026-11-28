'use client'

import { useState } from 'react'
import { Button, cx } from '@/components/ui'
import { TEAM_COLOURS, TEAM_EMOJIS, teamLabel, type DraftMember } from '@/lib/draft'

/** Name, emoji and colour for my own team in a draft. */
export default function TeamEditor({
  member,
  busy,
  onSave,
}: {
  member: DraftMember
  busy: boolean
  onSave: (name: string, emoji: string, colour: string) => void
}) {
  const [name, setName] = useState(member.team_name ?? '')
  const [emoji, setEmoji] = useState(member.team_emoji ?? '')
  const [colour, setColour] = useState(member.team_color ?? '')
  const trimmed = name.trim()
  const valid = trimmed === '' || (trimmed.length >= 2 && trimmed.length <= 24)

  return (
    <div className="space-y-3 text-sm">
      <div>
        <label htmlFor="team-name" className="mb-1 block text-xs font-medium text-slate-300">
          Team name
        </label>
        <input
          id="team-name"
          value={name}
          maxLength={24}
          onChange={(e) => setName(e.target.value)}
          placeholder={`e.g. ${member.username}'s Sixers`}
          className="w-full min-w-0 rounded-lg border border-slate-600 bg-slate-800/60 px-3 py-2 text-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
        />
      </div>
      <div>
        <p className="mb-1 text-xs font-medium text-slate-300">Emoji</p>
        <div className="flex flex-wrap gap-1.5">
          {TEAM_EMOJIS.map((e) => (
            <button
              key={e}
              type="button"
              onClick={() => setEmoji(emoji === e ? '' : e)}
              aria-pressed={emoji === e}
              className={cx('h-9 w-9 rounded-lg text-lg', emoji === e ? 'bg-emerald-500/40 ring-2 ring-emerald-400' : 'bg-white/10 hover:bg-white/20')}
            >
              {e}
            </button>
          ))}
        </div>
      </div>
      <div>
        <p className="mb-1 text-xs font-medium text-slate-300">Colour</p>
        <div className="flex flex-wrap gap-1.5">
          {TEAM_COLOURS.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setColour(colour === c ? '' : c)}
              aria-pressed={colour === c}
              aria-label={`Colour ${c}`}
              style={{ background: c }}
              className={cx('h-7 w-7 rounded-full', colour === c ? 'ring-2 ring-white ring-offset-2 ring-offset-slate-900' : '')}
            />
          ))}
        </div>
      </div>
      <div className="flex items-center justify-between gap-3">
        <span className="min-w-0 truncate text-slate-300">
          Shows as{' '}
          <span className="font-semibold" style={colour ? { color: colour } : undefined}>
            {teamLabel({ username: member.username, team_name: trimmed || null, team_emoji: emoji || null })}
          </span>
        </span>
        <Button size="sm" tone="draft" disabled={busy || !valid} onClick={() => onSave(trimmed, emoji, colour)}>
          Save
        </Button>
      </div>
      {!valid && <p className="text-xs text-red-300">A team name needs 2 to 24 characters.</p>}
    </div>
  )
}

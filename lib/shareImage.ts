/**
 * Draws a share card (PNG) for a day's recap, entirely in the browser with a
 * canvas, so nothing is uploaded. Used by the Home recap card.
 */
import { MEDALS } from '@/lib/fantasyPoints'
import type { Recap } from '@/lib/recap'

const W = 1080
const H = 1350

function fmt(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1)
}

function fit(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  if (ctx.measureText(text).width <= maxWidth) return text
  let t = text
  while (t.length > 1 && ctx.measureText(t + '…').width > maxWidth) t = t.slice(0, -1)
  return t + '…'
}

export function recapCanvas(r: Recap, event: string, accent = '#10b981'): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = H
  const ctx = canvas.getContext('2d')
  if (!ctx) return canvas

  const bg = ctx.createLinearGradient(0, 0, W, H)
  bg.addColorStop(0, '#020617')
  bg.addColorStop(0.55, '#1e1b4b')
  bg.addColorStop(1, '#0f172a')
  ctx.fillStyle = bg
  ctx.fillRect(0, 0, W, H)
  ctx.fillStyle = accent
  ctx.fillRect(0, 0, W, 14)

  ctx.textBaseline = 'alphabetic'
  ctx.fillStyle = '#94a3b8'
  ctx.font = '600 38px system-ui, sans-serif'
  ctx.fillText(event.toUpperCase() + ' · DAILY RECAP', 70, 120)

  ctx.fillStyle = '#ffffff'
  ctx.font = '800 76px system-ui, sans-serif'
  ctx.fillText(fit(ctx, r.teamName, W - 140), 70, 235)

  // rank
  const medal = r.points > 0 ? MEDALS[r.rank] : undefined
  ctx.font = '900 250px system-ui, sans-serif'
  ctx.fillStyle = r.rank === 1 && r.points > 0 ? '#facc15' : '#ffffff'
  ctx.fillText(medal ?? String(r.rank), 70, 500)
  const rankW = ctx.measureText(medal ?? String(r.rank)).width
  ctx.fillStyle = '#94a3b8'
  ctx.font = '600 44px system-ui, sans-serif'
  ctx.fillText(`of ${r.teams}`, 70 + rankW + 24, 500)

  // move
  if (r.move != null && r.move !== 0) {
    ctx.fillStyle = r.move > 0 ? '#34d399' : '#f87171'
    ctx.font = '800 72px system-ui, sans-serif'
    ctx.fillText(`${r.move > 0 ? '▲' : '▼'} ${Math.abs(r.move)}`, W - 70 - 180, 470)
  }

  // points
  ctx.fillStyle = '#ffffff'
  ctx.font = '900 130px system-ui, sans-serif'
  ctx.fillText(`${fmt(r.points)} pts`, 70, 660)
  if (r.gain != null) {
    ctx.fillStyle = r.gain > 0 ? '#34d399' : r.gain < 0 ? '#f87171' : '#94a3b8'
    ctx.font = '700 56px system-ui, sans-serif'
    ctx.fillText(`${r.gain > 0 ? '+' : ''}${fmt(r.gain)} today`, 70, 735)
  }

  // details
  // most interesting first; four fit above the footer
  const lines: [string, string][] = []
  if (r.best) lines.push(['Best player', `${r.best.name}  +${fmt(r.best.gain)}`])
  if (r.overtook.length) lines.push(['Passed', r.overtook.join(', ')])
  if (r.overtakenBy.length) lines.push(['Passed by', r.overtakenBy.join(', ')])
  if (r.leader && r.rank !== 1) lines.push(['Leader', `${r.leader.name}  ${fmt(r.leader.points)} pts`])
  if (r.worst) lines.push(['Quiet day', `${r.worst.name}  ${r.worst.gain > 0 ? '+' : ''}${fmt(r.worst.gain)}`])
  let y = 860
  for (const [label, value] of lines.slice(0, 4)) {
    ctx.fillStyle = '#64748b'
    ctx.font = '600 34px system-ui, sans-serif'
    ctx.fillText(label.toUpperCase(), 70, y)
    ctx.fillStyle = '#e2e8f0'
    ctx.font = '600 44px system-ui, sans-serif'
    ctx.fillText(fit(ctx, value, W - 140), 70, y + 50)
    y += 105
  }

  ctx.fillStyle = '#475569'
  ctx.font = '500 30px system-ui, sans-serif'
  ctx.fillText('Fantasy Cricket', 70, H - 50)
  return canvas
}

export function recapBlob(r: Recap, event: string, accent?: string): Promise<Blob | null> {
  return new Promise((resolve) => recapCanvas(r, event, accent).toBlob((b) => resolve(b), 'image/png'))
}

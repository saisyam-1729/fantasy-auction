'use client'

import { useState } from 'react'
import Image from 'next/image'
import { initials, teamColours } from '@/lib/teams'

/**
 * Player photo, or the player's initials on their franchise colour when there
 * is no photo (or it fails to load). Photos are stored by us (public/players)
 * or come from arbitrary hosts, so Next's optimizer is skipped (`unoptimized`).
 */
export default function PlayerAvatar({
  src,
  name,
  team,
  size,
  className = '',
}: {
  src: string | null
  name: string
  team?: string | null
  /** Pixel size of the square image (intrinsic; CSS decides the rendered size). */
  size: number
  className?: string
}) {
  // Remember which URL failed so a different player's photo gets a fresh try.
  const [failedSrc, setFailedSrc] = useState<string | null>(null)

  if (!src || failedSrc === src) {
    const { bg, fg } = teamColours(team)
    return (
      <div
        role="img"
        aria-label={name}
        className={`flex select-none items-center justify-center font-bold ${className}`}
        style={{ background: bg, color: fg, fontSize: Math.max(10, size * 0.38) }}
      >
        {initials(name)}
      </div>
    )
  }

  return (
    <Image
      src={src}
      alt={name}
      width={size}
      height={size}
      unoptimized
      onError={() => setFailedSrc(src)}
      className={`object-cover ${className}`}
    />
  )
}

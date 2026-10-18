'use client'

import Image from 'next/image'

const FALLBACK = 'https://images.unsplash.com/photo-1531415074968-036ba1b575da?w=200'

/**
 * Player photo. Image URLs come from arbitrary hosts, so Next's optimizer is
 * skipped (`unoptimized`); we still get lazy loading and fixed dimensions.
 */
export default function PlayerAvatar({
  src,
  name,
  size,
  className = '',
}: {
  src: string | null
  name: string
  /** Pixel size of the square image (intrinsic; CSS decides the rendered size). */
  size: number
  className?: string
}) {
  return (
    <Image
      src={src || FALLBACK}
      alt={name}
      width={size}
      height={size}
      unoptimized
      className={`object-cover ${className}`}
    />
  )
}

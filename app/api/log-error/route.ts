import { NextResponse, type NextRequest } from 'next/server'
import { createLimiter, sanitizeReport } from '@/lib/errorLog'

// Best effort per server instance: 20 reports a minute per caller.
const allow = createLimiter(20, 60_000)

/**
 * Receives browser errors and writes them to the server log, so they show up
 * under Logs in the Vercel dashboard. Nothing is stored. Reports are size-capped,
 * stripped of query strings, and rate limited.
 */
export async function POST(request: NextRequest) {
  const caller = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown'
  if (!allow(caller)) return new NextResponse(null, { status: 429 })

  let body: unknown
  try {
    const text = await request.text()
    if (text.length > 8000) return new NextResponse(null, { status: 413 })
    body = JSON.parse(text)
  } catch {
    return new NextResponse(null, { status: 400 })
  }

  const report = sanitizeReport(body)
  if (!report) return new NextResponse(null, { status: 400 })

  console.error('[client-error]', JSON.stringify(report))
  return new NextResponse(null, { status: 204 })
}

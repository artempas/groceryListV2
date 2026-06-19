import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { requireListAccess } from '@/lib/access'
import { subscribeListEvents, type ListEvent } from '@/lib/list-events'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const HEARTBEAT_MS = 15_000

export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const check = await requireListAccess(session.userId, params.id)
  if ('error' in check) return NextResponse.json({ error: check.error }, { status: check.status })

  const clientId = new URL(request.url).searchParams.get('clientId')
  const encoder = new TextEncoder()

  let unsubscribe: () => void = () => {}
  let heartbeat: ReturnType<typeof setInterval>
  let closed = false

  const cleanup = () => {
    if (closed) return
    closed = true
    unsubscribe()
    clearInterval(heartbeat)
    request.signal.removeEventListener('abort', cleanup)
  }

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const safeEnqueue = (chunk: Uint8Array) => {
        if (closed) return
        try {
          controller.enqueue(chunk)
        } catch {
          cleanup()
        }
      }

      const send = (event: ListEvent) => {
        // Don't echo an event back to the tab that caused it; it already applied it optimistically.
        if (clientId && event.originClientId === clientId) return
        safeEnqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`))
      }
      unsubscribe = subscribeListEvents(params.id, send)
      // Send an initial comment to flush HTTP headers so the client's fetch() resolves immediately.
      safeEnqueue(encoder.encode(`:\n\n`))
      heartbeat = setInterval(() => {
        safeEnqueue(encoder.encode(`:\n\n`))
      }, HEARTBEAT_MS)
    },
    cancel() {
      cleanup()
    },
  })

  request.signal.addEventListener('abort', cleanup)

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  })
}

export class MockEventSource {
  static instances: MockEventSource[] = []
  static reset() {
    MockEventSource.instances = []
  }

  // Mirror the real EventSource readyState constants.
  static readonly CONNECTING = 0
  static readonly OPEN = 1
  static readonly CLOSED = 2

  url: string
  readyState: number = MockEventSource.CONNECTING
  onmessage: ((e: { data: string }) => void) | null = null
  onopen: (() => void) | null = null
  onerror: (() => void) | null = null
  closed = false

  constructor(url: string) {
    this.url = url
    MockEventSource.instances.push(this)
  }

  close() {
    this.closed = true
    this.readyState = MockEventSource.CLOSED
  }
}

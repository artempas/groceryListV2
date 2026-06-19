import '@testing-library/jest-dom'
import { MockEventSource } from './tests/helpers/mock-event-source'

;(globalThis as unknown as { EventSource: unknown }).EventSource = MockEventSource

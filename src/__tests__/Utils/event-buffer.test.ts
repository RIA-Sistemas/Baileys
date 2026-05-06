import { jest } from '@jest/globals'
import P from 'pino'
import type { BaileysEvent, BaileysEventMap } from '../../Types'
import { makeEventBuffer } from '../../Utils/event-buffer'

const logger = P({ level: 'silent' })

type AggregatorCallback = (events: Partial<BaileysEventMap>) => void

describe('makeEventBuffer destroy()', () => {
	beforeEach(() => {
		jest.useFakeTimers()
	})

	afterEach(() => {
		jest.useRealTimers()
	})

	it('destroy() clears flushPendingTimeout scheduled by createBufferedFunction', async () => {
		// flushPendingTimeout is set ONLY in createBufferedFunction's `finally` block
		// when bufferCount returns to 0 (event-buffer.ts:229-231). Direct buffer()/flush()
		// never set it. Driving createBufferedFunction is the only realistic test.
		const buffer = makeEventBuffer(logger)

		const wrapped = buffer.createBufferedFunction(async () => 'done')
		await wrapped()
		// bufferCount returned to 0 → setTimeout(flush, 100) scheduled (flushPendingTimeout)
		// AND a separate untracked setTimeout(flush, 100) at line 215 (when bufferCount===1
		// post-work). The latter is benign (its callback re-checks isBuffering && bufferCount).

		const timersBeforeDestroy = jest.getTimerCount()
		expect(timersBeforeDestroy).toBeGreaterThanOrEqual(2)

		buffer.destroy()

		// destroy() must clear the TRACKED timers (bufferTimeout + flushPendingTimeout).
		// At least 1 must be cleared (flushPendingTimeout is the new patch from CR #2191).
		const timersAfterDestroy = jest.getTimerCount()
		expect(timersAfterDestroy).toBeLessThan(timersBeforeDestroy)

		// Belt-and-suspenders: any stray untracked timer's callback no-ops because
		// destroy() reset isBuffering=false. No aggregator emission must occur.
		const aggregator = jest.fn<AggregatorCallback>()
		buffer.process(aggregator)
		jest.advanceTimersByTime(500)
		expect(aggregator).not.toHaveBeenCalled()
	})

	it('destroy() clears bufferTimeout scheduled by buffer()', () => {
		// buffer() schedules bufferTimeout = setTimeout(autoFlush, BUFFER_TIMEOUT_MS=30s)
		// at event-buffer.ts:101-106. The autoFlush callback logs warn + calls flush().
		const warnSpy = jest.fn()
		const localLogger = {
			...logger,
			warn: warnSpy,
			child: () => localLogger
		} as unknown as Parameters<typeof makeEventBuffer>[0]
		const buffer = makeEventBuffer(localLogger)

		buffer.buffer()
		expect(jest.getTimerCount()).toBeGreaterThan(0)

		buffer.destroy()
		// Existing destroy() cleanup of bufferTimeout: must reach 0 timers.
		expect(jest.getTimerCount()).toBe(0)

		// Advance 2× BUFFER_TIMEOUT_MS — auto-flush warn must NOT fire.
		jest.advanceTimersByTime(60_000)
		expect(warnSpy).not.toHaveBeenCalled()
	})
})

// Suppress unused-import lint by type-referencing.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
type _RefBaileysEvent = BaileysEvent

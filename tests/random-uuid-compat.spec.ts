import { afterEach, describe, expect, it, vi } from 'vitest'
import { installRandomUuidCompatibility } from '../src/client/random-uuid-compat.ts'

describe('randomUUID compatibility', () => {
  afterEach(() => { vi.unstubAllGlobals() })

  it('uses getRandomValues when an HTTP origin omits randomUUID', () => {
    vi.stubGlobal('crypto', {
      getRandomValues(bytes: Uint8Array) {
        return bytes.fill(0)
      },
    })
    expect(installRandomUuidCompatibility()).toBe(true)
    expect(globalThis.crypto.randomUUID()).toBe('00000000-0000-4000-8000-000000000000')
  })

  it('does not advertise weak Web Crypto when the whole API is absent', () => {
    vi.stubGlobal('crypto', undefined)
    expect(installRandomUuidCompatibility()).toBe(false)
  })
})

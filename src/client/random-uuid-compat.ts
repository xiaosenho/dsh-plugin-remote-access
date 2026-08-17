/** Browser compatibility for Harness releases that require secure-context randomUUID. */

function uuidFrom(bytes: Uint8Array): `${string}-${string}-${string}-${string}-${string}` {
  bytes[6] = (bytes[6] as number & 0x0f) | 0x40
  bytes[8] = (bytes[8] as number & 0x3f) | 0x80
  const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

/**
 * Add `crypto.randomUUID()` when Web Crypto exists but an HTTP origin omits that secure-context method.
 * @returns true when the method is available after this call.
 */
export function installRandomUuidCompatibility(): boolean {
  const crypto = globalThis.crypto
  if (typeof crypto?.randomUUID === 'function') return true
  if (typeof crypto?.getRandomValues !== 'function') return false
  Object.defineProperty(crypto, 'randomUUID', {
    configurable: true,
    value: (): `${string}-${string}-${string}-${string}-${string}` =>
      uuidFrom(crypto.getRandomValues(new Uint8Array(16))),
  })
  return true
}

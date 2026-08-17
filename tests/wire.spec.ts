import { describe, expect, it } from 'vitest'
import { parseRemoteAccessSnapshot } from '../src/wire.ts'

describe('remote-access wire compatibility', () => {
  it('accepts settings saved before tunnel endpoint selection was introduced', () => {
    expect(parseRemoteAccessSnapshot({
      settings: {
        enabled: true,
        mode: 'tunnel',
        listenPort: 3081,
        serverAddr: '203.0.113.10',
        serverPort: 7000,
        remotePort: 8080,
        publicUrl: 'https://203.0.113.10:8080',
        serverTokenConfigured: true,
      },
      phase: 'running',
      links: [],
    }).settings.tunnelEndpoint).toBeUndefined()
  })
})

import { createServer, request as httpRequest } from 'node:http'
import type { Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createControlRoute, type RemoteAccessController } from '../src/control-api.ts'
import type { RemoteAccessSnapshot } from '../src/types.ts'

const snapshot: RemoteAccessSnapshot = {
  settings: {
    enabled: false,
    mode: 'lan',
    listenPort: 3081,
    serverAddr: '',
    serverPort: 7000,
    publicUrl: '',
    serverTokenConfigured: false,
  },
  phase: 'disabled',
  links: [],
}

function listen(server: Server): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject)
      resolve((server.address() as AddressInfo).port)
    })
  })
}

function close(server: Server): Promise<void> {
  return new Promise(resolve => { server.close(() => { resolve() }) })
}

function requestWithHost(port: number, host: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const request = httpRequest({ host: '127.0.0.1', port, path: '/_dsh/remote-access/status', headers: { host } }, (response) => {
      response.resume()
      response.on('end', () => { resolve(response.statusCode ?? 0) })
    })
    request.on('error', reject)
    request.end()
  })
}

describe('control route', () => {
  let server: Server | undefined

  afterEach(async () => {
    if (server !== undefined) await close(server)
  })

  it('serves validated operations only through the loopback authority', async () => {
    const update = vi.fn<RemoteAccessController['update']>().mockResolvedValue(snapshot)
    const controller: RemoteAccessController = {
      status: () => snapshot,
      update,
      enable: vi.fn().mockResolvedValue(snapshot),
      disable: vi.fn().mockResolvedValue(snapshot),
    }
    const route = createControlRoute(controller, 1024)
    server = createServer((request, response) => { void route.handler(request, response) })
    const port = await listen(server)
    const base = `http://127.0.0.1:${String(port)}/_dsh/remote-access`

    const status = await fetch(`${base}/status`)
    expect(status.status).toBe(200)
    expect(await status.json()).toEqual(snapshot)

    const saved = await fetch(`${base}/update`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ mode: 'tunnel', serverPort: 7001 }),
    })
    expect(saved.status).toBe(200)
    expect(update).toHaveBeenCalledWith({ mode: 'tunnel', serverPort: 7001 })

    expect(await requestWithHost(port, 'attacker.example')).toBe(403)
    expect((await fetch(`${base}/enable`, { method: 'POST', headers: { 'sec-fetch-site': 'cross-site' } })).status).toBe(403)
  })

  it('rejects invalid and oversized update payloads', async () => {
    const controller: RemoteAccessController = {
      status: () => snapshot,
      update: vi.fn().mockResolvedValue(snapshot),
      enable: vi.fn().mockResolvedValue(snapshot),
      disable: vi.fn().mockResolvedValue(snapshot),
    }
    const route = createControlRoute(controller, 16)
    server = createServer((request, response) => { void route.handler(request, response) })
    const port = await listen(server)
    const url = `http://127.0.0.1:${String(port)}/_dsh/remote-access/update`

    expect((await fetch(url, { method: 'POST', body: '{' })).status).toBe(400)
    expect((await fetch(url, { method: 'POST', body: JSON.stringify({ serverAddr: 'this-is-too-large' }) })).status).toBe(400)
  })
})

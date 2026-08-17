import { createServer } from 'node:http'
import type { Server } from 'node:http'
import { connect } from 'node:net'
import type { AddressInfo } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { startAuthenticatedProxy, type AuthenticatedProxy } from '../src/proxy.ts'

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

function upgrade(port: number, cookie?: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = connect(port, '127.0.0.1')
    let response = ''
    socket.on('error', reject)
    socket.on('data', (chunk) => {
      response += chunk.toString()
      if (!response.includes('\r\n\r\n')) return
      socket.destroy()
      resolve(response)
    })
    socket.on('connect', () => {
      socket.write([
        'GET /api/events.host HTTP/1.1',
        `Host: 127.0.0.1:${String(port)}`,
        'Connection: Upgrade',
        'Upgrade: websocket',
        'Sec-WebSocket-Version: 13',
        'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==',
        ...(cookie === undefined ? [] : [`Cookie: ${cookie}`]),
        '',
        '',
      ].join('\r\n'))
    })
  })
}

describe('authenticated proxy', () => {
  let upstream: Server | undefined
  let proxy: AuthenticatedProxy | undefined

  afterEach(async () => {
    await proxy?.close()
    if (upstream !== undefined) await close(upstream)
  })

  it('exchanges a bearer link for a cookie and strips remote credentials upstream', async () => {
    upstream = createServer((request, response) => {
      response.setHeader('content-type', 'application/json')
      response.end(JSON.stringify({
        host: request.headers.host,
        origin: request.headers.origin,
        cookie: request.headers.cookie,
        fetchSite: request.headers['sec-fetch-site'],
      }))
    })
    const upstreamPort = await listen(upstream)
    proxy = await startAuthenticatedProxy({
      bindHost: '127.0.0.1',
      listenPort: 0,
      upstreamPort,
      publicBases: ['https://dsh.example.com'],
      secureCookie: true,
    })

    const base = `http://127.0.0.1:${String(proxy.port)}`
    expect((await fetch(base)).status).toBe(401)

    const loginPath = new URL(proxy.links[0] as string)
    const login = await fetch(`${base}${loginPath.pathname}${loginPath.search}`, { redirect: 'manual' })
    expect(login.status).toBe(303)
    expect(login.headers.get('location')).toBe('/?dsh-remote-authenticated=1')
    expect(login.headers.get('location')).not.toContain('token')
    const setCookie = login.headers.get('set-cookie') as string
    expect(setCookie).toContain('HttpOnly')
    expect(setCookie).toContain('SameSite=Strict')
    expect(setCookie).toContain('Secure')

    const cookie = setCookie.split(';', 1)[0] as string
    const response = await fetch(`${base}/api/example`, {
      headers: { cookie, origin: 'https://dsh.example.com' },
    })
    expect(await response.json()).toEqual({
      host: `127.0.0.1:${String(upstreamPort)}`,
      origin: `http://127.0.0.1:${String(upstreamPort)}`,
      fetchSite: 'same-origin',
    })
  })

  it('rejects an invalid login token without setting a cookie', async () => {
    upstream = createServer((_request, response) => { response.end('ok') })
    const upstreamPort = await listen(upstream)
    proxy = await startAuthenticatedProxy({
      bindHost: '127.0.0.1',
      listenPort: 0,
      upstreamPort,
      publicBases: ['http://127.0.0.1'],
      secureCookie: false,
    })
    const response = await fetch(`http://127.0.0.1:${String(proxy.port)}/_dsh/remote-login?token=wrong`)
    expect(response.status).toBe(401)
    expect(response.headers.get('set-cookie')).toBeNull()
  })

  it('applies the same cookie requirement to WebSocket upgrades', async () => {
    upstream = createServer()
    upstream.on('upgrade', (_request, socket) => {
      socket.end('HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n')
    })
    const upstreamPort = await listen(upstream)
    proxy = await startAuthenticatedProxy({
      bindHost: '127.0.0.1',
      listenPort: 0,
      upstreamPort,
      publicBases: ['http://127.0.0.1'],
      secureCookie: false,
    })
    expect(await upgrade(proxy.port)).toContain('401 Unauthorized')

    const loginPath = new URL(proxy.links[0] as string)
    const login = await fetch(
      `http://127.0.0.1:${String(proxy.port)}${loginPath.pathname}${loginPath.search}`,
      { redirect: 'manual' },
    )
    const cookie = login.headers.get('set-cookie')?.split(';', 1)[0]
    expect(cookie).toBeDefined()
    expect(await upgrade(proxy.port, cookie)).toContain('101 Switching Protocols')
  })
})

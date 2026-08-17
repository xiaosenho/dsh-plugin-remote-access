/** Authenticated HTTP/WebSocket reverse proxy for one remote-access activation. */

import { randomBytes, timingSafeEqual } from 'node:crypto'
import { createServer, request as httpRequest } from 'node:http'
import type { IncomingHttpHeaders, IncomingMessage, Server, ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import type { Duplex } from 'node:stream'

const LOGIN_PATH = '/_dsh/remote-login'
const COOKIE_NAME = 'dsh_remote'

/** Active authenticated proxy and the login links derived from it. */
export interface AuthenticatedProxy {
  readonly port: number
  readonly links: readonly string[]
  /** Stop accepting requests and close ordinary and upgraded connections. */
  close(): Promise<void>
}

/** Inputs resolved by the remote-access service before binding. */
export interface AuthenticatedProxySpec {
  readonly bindHost: '127.0.0.1' | '0.0.0.0'
  readonly listenPort: number
  readonly upstreamPort: number
  readonly publicBases: readonly string[]
  readonly secureCookie: boolean
}

function equalSecret(actual: string, expected: string): boolean {
  const left = Buffer.from(actual)
  const right = Buffer.from(expected)
  return left.length === right.length && timingSafeEqual(left, right)
}

function cookieValue(headers: IncomingHttpHeaders): string | undefined {
  const cookie = headers.cookie
  if (cookie === undefined) return undefined
  for (const part of cookie.split(';')) {
    const [name, ...value] = part.trim().split('=')
    if (name === COOKIE_NAME) return value.join('=')
  }
  return undefined
}

function authorized(request: IncomingMessage, secret: string): boolean {
  const value = cookieValue(request.headers)
  return value !== undefined && equalSecret(value, secret)
}

function upstreamHeaders(request: IncomingMessage, upstreamPort: number, upgrade: boolean): IncomingHttpHeaders {
  const headers: IncomingHttpHeaders = { ...request.headers }
  delete headers.cookie
  delete headers['proxy-authorization']
  delete headers['proxy-connection']
  headers.host = `127.0.0.1:${String(upstreamPort)}`
  if (headers.origin !== undefined) headers.origin = `http://127.0.0.1:${String(upstreamPort)}`
  headers['sec-fetch-site'] = 'same-origin'
  if (!upgrade) {
    delete headers.connection
    delete headers.upgrade
  }
  return headers
}

function login(request: IncomingMessage, response: ServerResponse, secret: string, secureCookie: boolean): boolean {
  const url = new URL(request.url ?? '/', 'http://remote.invalid')
  if (url.pathname !== LOGIN_PATH) return false
  const token = url.searchParams.get('token')
  if (token === null || !equalSecret(token, secret)) {
    response.writeHead(401, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' })
    response.end('Unauthorized')
    return true
  }
  const attributes = [`${COOKIE_NAME}=${secret}`, 'Path=/', 'HttpOnly', 'SameSite=Strict']
  if (secureCookie) attributes.push('Secure')
  response.writeHead(303, {
    location: '/?dsh-remote-authenticated=1',
    'set-cookie': attributes.join('; '),
    'cache-control': 'no-store',
    'referrer-policy': 'no-referrer',
  })
  response.end()
  return true
}

function rejectHttp(response: ServerResponse): void {
  response.writeHead(401, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' })
  response.end('Unauthorized')
}

function rejectUpgrade(socket: Duplex): void {
  socket.end('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\nContent-Length: 0\r\n\r\n')
}

function writeUpgradeHead(socket: Duplex, response: IncomingMessage): void {
  const lines = [`HTTP/${response.httpVersion} ${String(response.statusCode ?? 101)} ${response.statusMessage ?? 'Switching Protocols'}`]
  for (let index = 0; index < response.rawHeaders.length; index += 2) {
    lines.push(`${response.rawHeaders[index]}: ${response.rawHeaders[index + 1]}`)
  }
  socket.write(`${lines.join('\r\n')}\r\n\r\n`)
}

/** Start one authenticated proxy over the already-bound loopback Web server. */
export async function startAuthenticatedProxy(spec: AuthenticatedProxySpec): Promise<AuthenticatedProxy> {
  const secret = randomBytes(32).toString('base64url')
  const upgraded = new Set<Duplex>()
  const server: Server = createServer((request, response) => {
    try {
      if (login(request, response, secret, spec.secureCookie)) return
      if (!authorized(request, secret)) {
        rejectHttp(response)
        return
      }
      const proxy = httpRequest({
        host: '127.0.0.1',
        port: spec.upstreamPort,
        method: request.method,
        path: request.url,
        headers: upstreamHeaders(request, spec.upstreamPort, false),
      }, (upstream) => {
        response.writeHead(upstream.statusCode ?? 502, upstream.headers)
        upstream.pipe(response)
      })
      proxy.on('error', () => {
        if (response.headersSent) response.destroy()
        else {
          response.writeHead(502)
          response.end('Bad Gateway')
        }
      })
      request.pipe(proxy)
    } catch {
      if (response.headersSent) response.destroy()
      else {
        response.writeHead(400)
        response.end('Bad Request')
      }
    }
  })

  server.on('upgrade', (request, socket, head) => {
    if (!authorized(request, secret)) {
      rejectUpgrade(socket)
      return
    }
    upgraded.add(socket)
    socket.once('close', () => { upgraded.delete(socket) })
    const proxy = httpRequest({
      host: '127.0.0.1',
      port: spec.upstreamPort,
      method: request.method,
      path: request.url,
      headers: upstreamHeaders(request, spec.upstreamPort, true),
    })
    proxy.on('upgrade', (upstreamResponse, upstreamSocket, upstreamHead) => {
      upgraded.add(upstreamSocket)
      upstreamSocket.once('close', () => { upgraded.delete(upstreamSocket) })
      writeUpgradeHead(socket, upstreamResponse)
      if (upstreamHead.length > 0) socket.write(upstreamHead)
      if (head.length > 0) upstreamSocket.write(head)
      socket.pipe(upstreamSocket).pipe(socket)
    })
    proxy.on('response', (upstreamResponse) => {
      writeUpgradeHead(socket, upstreamResponse)
      upstreamResponse.pipe(socket)
    })
    proxy.on('error', () => { socket.destroy() })
    proxy.end()
  })

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(spec.listenPort, spec.bindHost, () => {
      server.off('error', reject)
      resolve()
    })
  })
  const port = (server.address() as AddressInfo).port
  const links = spec.publicBases.map((base) => {
    const url = new URL(LOGIN_PATH, base.endsWith('/') ? base : `${base}/`)
    url.searchParams.set('token', secret)
    return url.href
  })
  return {
    port,
    links,
    close: () => new Promise<void>((resolve) => {
      server.close(() => { resolve() })
      server.closeAllConnections()
      for (const socket of upgraded) socket.destroy()
    }),
  }
}

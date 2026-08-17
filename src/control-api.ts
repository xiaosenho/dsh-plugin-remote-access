/** Loopback-only JSON control route used by the browser settings section. */

import type { IncomingMessage, ServerResponse } from 'node:http'
import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'
import type { RemoteAccessSnapshot, RemoteAccessUpdate } from './types.ts'
import { parseRemoteAccessUpdate } from './wire.ts'

const BASE_PATH = '/_dsh/remote-access'

/** Operations exposed by the control route without exporting the Service implementation. */
export interface RemoteAccessController {
  status(): RemoteAccessSnapshot
  update(request: RemoteAccessUpdate): Promise<RemoteAccessSnapshot>
  enable(): Promise<RemoteAccessSnapshot>
  disable(): Promise<RemoteAccessSnapshot>
}

function isLoopbackAddress(address: string | undefined): boolean {
  return address === '127.0.0.1' || address === '::1' || address?.startsWith('::ffff:127.') === true
}

function trusted(request: IncomingMessage): boolean {
  if (!isLoopbackAddress(request.socket.remoteAddress)) return false
  const host = request.headers.host
  if (host === undefined) return false
  let hostname: string
  try {
    hostname = new URL(`http://${host}`).hostname
  } catch {
    return false
  }
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(hostname)) return false
  const fetchSite = request.headers['sec-fetch-site']
  return fetchSite === undefined || fetchSite === 'same-origin' || fetchSite === 'none'
}

function writeJson(response: ServerResponse, status: number, value: unknown): void {
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  })
  response.end(JSON.stringify(value))
}

async function readJson(request: IncomingMessage, maxBytes: number): Promise<unknown> {
  const chunks: Buffer[] = []
  let bytes = 0
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    bytes += buffer.length
    if (bytes > maxBytes) throw new Error('request body is too large')
    chunks.push(buffer)
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown
}

/** Build the package-owned, loopback-only route. */
export function createControlRoute(controller: RemoteAccessController, maxBytes: number): WebRoute {
  return {
    kind: 'prefix',
    path: BASE_PATH,
    handler: async (request, response) => {
      if (!trusted(request)) {
        writeJson(response, 403, { error: 'remote access controls require an authenticated local channel' })
        return
      }
      const pathname = new URL(request.url ?? '/', 'http://localhost').pathname
      const action = pathname.slice(BASE_PATH.length)
      try {
        if (request.method === 'GET' && action === '/status') {
          writeJson(response, 200, controller.status())
          return
        }
        if (request.method === 'POST' && action === '/update') {
          const update = parseRemoteAccessUpdate(await readJson(request, maxBytes))
          writeJson(response, 200, await controller.update(update))
          return
        }
        if (request.method === 'POST' && action === '/enable') {
          writeJson(response, 200, await controller.enable())
          return
        }
        if (request.method === 'POST' && action === '/disable') {
          writeJson(response, 200, await controller.disable())
          return
        }
        writeJson(response, 405, { error: 'method or action is not supported' })
      } catch (error) {
        writeJson(response, 400, { error: error instanceof Error ? error.message : String(error) })
      }
    },
  }
}

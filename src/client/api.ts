/** Browser client for the package-owned remote-access control route. */

import type { RemoteAccessSnapshot, RemoteAccessUpdate } from '../types.ts'
import { parseRemoteAccessSnapshot, RemoteAccessErrorSchema } from '../wire.ts'

const BASE_PATH = '/_dsh/remote-access'

async function call(action: string, request?: RemoteAccessUpdate): Promise<RemoteAccessSnapshot> {
  const response = await fetch(`${BASE_PATH}/${action}`, request === undefined
    ? { method: action === 'status' ? 'GET' : 'POST' }
    : {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(request),
      })
  const json: unknown = await response.json()
  if (!response.ok) {
    const parsed = RemoteAccessErrorSchema.safeParse(json)
    throw new Error(parsed.success ? parsed.data.error : `remote-access request failed with HTTP ${String(response.status)}`)
  }
  return parseRemoteAccessSnapshot(json)
}

/** Browser operations injected into the Settings component. */
export const remoteAccessApi = {
  status: (): Promise<RemoteAccessSnapshot> => call('status'),
  update: (request: RemoteAccessUpdate): Promise<RemoteAccessSnapshot> => call('update', request),
  enable: (): Promise<RemoteAccessSnapshot> => call('enable'),
  disable: (): Promise<RemoteAccessSnapshot> => call('disable'),
}

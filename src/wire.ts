/** Runtime validation for the package-owned browser control route. */

import { z } from 'zod'
import type { RemoteAccessSnapshot, RemoteAccessUpdate } from './types.ts'

export const RemoteAccessUpdateSchema = z.strictObject({
  mode: z.enum(['lan', 'tunnel']).optional(),
  listenPort: z.number().int().min(1).max(65535).optional(),
  frpcPath: z.string().optional(),
  serverAddr: z.string().optional(),
  serverPort: z.number().int().min(1).max(65535).optional(),
  serverToken: z.string().optional(),
  clearServerToken: z.boolean().optional(),
  tunnelEndpoint: z.enum(['domain', 'ip']).optional(),
  remotePort: z.number().int().min(1).max(65535).optional(),
  publicUrl: z.string().optional(),
})

export const RemoteAccessSnapshotSchema = z.strictObject({
  settings: z.strictObject({
    enabled: z.boolean(),
    mode: z.enum(['lan', 'tunnel']),
    listenPort: z.number().int().min(1).max(65535),
    frpcPath: z.string().default('frpc'),
    serverAddr: z.string(),
    serverPort: z.number().int().min(1).max(65535),
    tunnelEndpoint: z.enum(['domain', 'ip']).optional(),
    remotePort: z.number().int().min(1).max(65535),
    publicUrl: z.string(),
    serverTokenConfigured: z.boolean(),
  }),
  phase: z.enum(['disabled', 'starting', 'running', 'error']),
  links: z.array(z.string().url()).readonly(),
  error: z.string().optional(),
})

export const RemoteAccessErrorSchema = z.strictObject({ error: z.string() })

export const FrpcSelectionSchema = z.strictObject({ path: z.string().nullable() })

/** Validate one browser mutation and expose its exact-optional public type. */
export function parseRemoteAccessUpdate(value: unknown): RemoteAccessUpdate {
  return RemoteAccessUpdateSchema.parse(value) as RemoteAccessUpdate
}

/** Validate one Host response and expose its exact-optional public type. */
export function parseRemoteAccessSnapshot(value: unknown): RemoteAccessSnapshot {
  return RemoteAccessSnapshotSchema.parse(value) as RemoteAccessSnapshot
}

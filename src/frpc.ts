/** Managed frpc process and private TOML configuration lifecycle. */

import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { SubprocessHandle, SubprocessRuntime } from '@deepseek-ai/dsh-subprocess'
import type { TunnelEndpointMode } from './types.ts'

/** Resolved tunnel start specification. */
export interface FrpcSpec {
  readonly executable: string
  readonly serverAddr: string
  readonly serverPort: number
  readonly serverToken: string
  readonly localPort: number
  readonly tunnelEndpoint: TunnelEndpointMode
  readonly remotePort: number
  readonly publicUrl: string
  readonly graceMs: number
  readonly startupTimeoutMs: number
  readonly outputMaxBytes: number
}

/** Live frpc process owned by one remote-access activation. */
export interface FrpcHandle {
  readonly done: Promise<never>
  close(): Promise<void>
}

function tomlString(value: string): string {
  return JSON.stringify(value)
}

function renderConfig(spec: FrpcSpec): string {
  const proxy = spec.tunnelEndpoint === 'domain'
    ? [
        'type = "http"',
        'localIP = "127.0.0.1"',
        `localPort = ${String(spec.localPort)}`,
        `customDomains = [${tomlString(new URL(spec.publicUrl).hostname)}]`,
      ]
    : [
        'type = "tcp"',
        'localIP = "127.0.0.1"',
        `localPort = ${String(spec.localPort)}`,
        `remotePort = ${String(spec.remotePort)}`,
      ]
  return [
    `serverAddr = ${tomlString(spec.serverAddr)}`,
    `serverPort = ${String(spec.serverPort)}`,
    '',
    '[auth]',
    'method = "token"',
    `token = ${tomlString(spec.serverToken)}`,
    '',
    '[[proxies]]',
    'name = "deepseek-harness-web"',
    ...proxy,
    '',
  ].join('\n')
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function processFailure(handle: SubprocessHandle): Promise<never> {
  return handle.done.then((outcome) => {
    throw new Error(`frpc exited (code ${String(outcome.exitCode)}, signal ${String(outcome.signal)})`)
  })
}

/** Resolve, configure, and start frpc without exposing its token in argv. */
export async function startFrpc(runtime: SubprocessRuntime, spec: FrpcSpec): Promise<FrpcHandle> {
  const executable = await runtime.resolveExecutable(spec.executable)
  const directory = await mkdtemp(join(tmpdir(), 'dsh-frpc-'))
  const configPath = join(directory, 'frpc.toml')
  await writeFile(configPath, renderConfig(spec), { flag: 'wx', mode: 0o600 })
  let handle: SubprocessHandle
  try {
    handle = runtime.spawn({
      argv: [executable, '-c', configPath],
      cwd: directory,
      stdio: {
        stdin: 'ignore',
        stdout: { maxBytes: spec.outputMaxBytes },
        stderr: { maxBytes: spec.outputMaxBytes },
      },
      graceMs: spec.graceMs,
    })
  } catch (error) {
    await rm(directory, { recursive: true, force: true })
    throw error
  }
  const done = processFailure(handle)
  let cleaned = false
  const cleanup = async (terminate: boolean): Promise<void> => {
    if (cleaned) return
    cleaned = true
    let failure: unknown
    try {
      if (terminate) {
        try {
          handle.terminate()
        } catch (error) {
          failure = error
        }
      }
      try {
        await handle.done
        if (!await handle.waitForExit()) throw new Error('frpc process tree did not reach quiescence')
      } catch (error) {
        failure ??= error
      }
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
    if (failure !== undefined) throw failure
  }
  try {
    await Promise.race([done, delay(spec.startupTimeoutMs)])
  } catch (error) {
    await cleanup(false)
    throw error
  }
  return {
    done,
    close: () => cleanup(true),
  }
}

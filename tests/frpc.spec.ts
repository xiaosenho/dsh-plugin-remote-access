import { access, readFile, stat } from 'node:fs/promises'
import type {
  SubprocessHandle, SubprocessOutcome, SubprocessRuntime, SubprocessSpawnSpec,
} from '@deepseek-ai/dsh-subprocess'
import { describe, expect, it, vi } from 'vitest'
import { startFrpc, type FrpcSpec } from '../src/frpc.ts'

const spec: FrpcSpec = {
  executable: 'frpc',
  serverAddr: 'frps.example.com',
  serverPort: 7000,
  serverToken: 'server-secret',
  localPort: 3081,
  tunnelEndpoint: 'domain',
  remotePort: 8080,
  publicUrl: 'https://dsh.example.com',
  graceMs: 3000,
  startupTimeoutMs: 1,
  outputMaxBytes: 4096,
}

function fakeRuntime(initialOutcome?: SubprocessOutcome): {
  runtime: SubprocessRuntime
  spawn: ReturnType<typeof vi.fn<(request: SubprocessSpawnSpec) => SubprocessHandle>>
  finish: (outcome: SubprocessOutcome) => void
} {
  let finish!: (outcome: SubprocessOutcome) => void
  const done = initialOutcome === undefined
    ? new Promise<SubprocessOutcome>(resolve => { finish = resolve })
    : Promise.resolve(initialOutcome)
  const handle: SubprocessHandle = {
    pid: 42,
    stdin: undefined,
    stdout: undefined,
    stderr: undefined,
    collected: {},
    done,
    terminate: () => { finish({ exitCode: null, signal: 'SIGTERM' }) },
    waitForExit: vi.fn().mockResolvedValue(true),
  }
  const spawn = vi.fn((_request: SubprocessSpawnSpec) => handle)
  const runtime = {
    resolveExecutable: vi.fn().mockResolvedValue('/usr/local/bin/frpc'),
    spawn,
  } as unknown as SubprocessRuntime
  return { runtime, spawn, finish }
}

describe('frpc lifecycle', () => {
  it('keeps the token out of argv and removes the private config after close', async () => {
    const fake = fakeRuntime()
    const handle = await startFrpc(fake.runtime, spec)
    const request = fake.spawn.mock.calls[0]?.[0]
    expect(request?.argv.slice(0, 2)).toEqual(['/usr/local/bin/frpc', '-c'])
    expect(JSON.stringify(request?.argv)).not.toContain(spec.serverToken)
    expect(request?.stdio.stdout).toEqual({ maxBytes: spec.outputMaxBytes })

    const configPath = request?.argv[2] as string
    const config = await readFile(configPath, 'utf8')
    expect(config).toContain('token = "server-secret"')
    expect(config).toContain('customDomains = ["dsh.example.com"]')
    expect((await stat(configPath)).mode & 0o777).toBe(0o600)

    await handle.close()
    await expect(access(configPath)).rejects.toThrow()
  })

  it('removes the private config when frpc exits during startup', async () => {
    const fake = fakeRuntime({ exitCode: 1, signal: null })
    await expect(startFrpc(fake.runtime, spec)).rejects.toThrow('frpc exited (code 1, signal null)')
    const configPath = fake.spawn.mock.calls[0]?.[0].argv[2] as string
    await expect(access(configPath)).rejects.toThrow()
  })

  it('uses a dedicated frps TCP port for direct IP access', async () => {
    const fake = fakeRuntime()
    const handle = await startFrpc(fake.runtime, {
      ...spec,
      tunnelEndpoint: 'ip',
      remotePort: 18080,
      publicUrl: 'http://203.0.113.10:18080',
    })
    const configPath = fake.spawn.mock.calls[0]?.[0].argv[2] as string
    const config = await readFile(configPath, 'utf8')
    expect(config).toContain('type = "tcp"')
    expect(config).toContain('remotePort = 18080')
    expect(config).not.toContain('customDomains')
    await handle.close()
  })
})

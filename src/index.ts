/** Authenticated LAN and frpc tunnel access to the loopback Web application. */

import { networkInterfaces } from 'node:os'
import { Service } from '@deepseek-ai/cordis'
import type { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import { settingsNamespace, type SettingsScope } from '@deepseek-ai/dsh-settings'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type {} from '@deepseek-ai/dsh-subprocess'
import { createControlRoute } from './control-api.ts'
import { startAuthenticatedProxy, type AuthenticatedProxy } from './proxy.ts'
import { startFrpc, type FrpcHandle } from './frpc.ts'
import type {
  RemoteAccessSettings, RemoteAccessSettingsView, RemoteAccessSnapshot, RemoteAccessUpdate,
} from './types.ts'

export type * from './types.ts'

const SETTINGS_NAMESPACE = settingsNamespace('remote-access')

/** Deployment defaults and process limits. */
export interface Config {
  readonly listenPort: number
  readonly frpcPath: string
  readonly processGraceMs: number
  readonly frpcStartupTimeoutMs: number
  readonly frpcOutputMaxBytes: number
  readonly requestMaxBytes: number
}

/** Validated deployment configuration with defaults suitable for the Web profile. */
export const Config: Schema<Config> = Schema.object({
  listenPort: Schema.natural().min(1).max(65535).default(3081),
  frpcPath: Schema.string().default('frpc'),
  processGraceMs: Schema.natural().min(1).default(3000),
  frpcStartupTimeoutMs: Schema.natural().min(1).default(500),
  frpcOutputMaxBytes: Schema.natural().min(1).default(32768),
  requestMaxBytes: Schema.natural().min(1).default(16384),
})

const SettingsSchema: Schema<RemoteAccessSettings> = Schema.object({
  enabled: Schema.boolean().required(),
  mode: Schema.union([Schema.const('lan'), Schema.const('tunnel')]).required(),
  listenPort: Schema.natural().min(1).max(65535).required(),
  serverAddr: Schema.string().required(),
  serverPort: Schema.natural().min(1).max(65535).required(),
  serverToken: Schema.string().role('secret').required(),
  publicUrl: Schema.string().required(),
})

interface ActiveAccess {
  readonly fingerprint: string
  readonly proxy: AuthenticatedProxy
  readonly frpc?: FrpcHandle
}

function validateSettings(settings: RemoteAccessSettings): void {
  if (!settings.enabled || settings.mode === 'lan') return
  if (settings.serverAddr.trim().length === 0) throw new Error('frps server address is required')
  if (settings.serverToken.length === 0) throw new Error('frps server token is required')
  let url: URL
  try {
    url = new URL(settings.publicUrl)
  } catch {
    throw new Error('public URL must be an absolute HTTP or HTTPS URL')
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.username !== '' || url.password !== ''
    || url.pathname !== '/' || url.search !== '' || url.hash !== '') {
    throw new Error('public URL must contain only an HTTP(S) scheme and authority')
  }
}

function lanBases(port: number): string[] {
  return Object.values(networkInterfaces()).flat()
    .filter((entry): entry is NonNullable<typeof entry> =>
      entry !== undefined && entry.family === 'IPv4' && !entry.internal)
    .map(entry => `http://${entry.address}:${String(port)}`)
}

function settingsView(settings: RemoteAccessSettings): RemoteAccessSettingsView {
  const { serverToken, ...visible } = settings
  return { ...visible, serverTokenConfigured: serverToken.length > 0 }
}

function fingerprint(settings: RemoteAccessSettings): string {
  return JSON.stringify(settings)
}

/** Own the authenticated proxy, optional frpc process, durable settings, and control route. */
export class RemoteAccessGateway extends Service {
  static inject = ['settings', 'webServer', 'subprocess']
  static Config = Config

  private scope!: SettingsScope<RemoteAccessSettings>
  private active: ActiveAccess | undefined
  private phase: RemoteAccessSnapshot['phase'] = 'disabled'
  private error: string | undefined
  private operations: Promise<void> = Promise.resolve()
  private disposed = false

  constructor(ctx: Context, private readonly config: Config) {
    super(ctx, 'remoteAccess')
  }

  protected async [Service.init](): Promise<void> {
    this.scope = this.ctx.settings.register(SETTINGS_NAMESPACE, SettingsSchema, {
      base: {
        enabled: false,
        mode: 'lan',
        listenPort: this.config.listenPort,
        serverAddr: '',
        serverPort: 7000,
        serverToken: '',
        publicUrl: '',
      },
      validate: validateSettings,
    })
    this.ctx.effect(() => async () => {
      this.disposed = true
      await this.operations
      await this.stopActive()
    }, 'remote-access: runtime')
    this.ctx.effect(() => this.scope.watch(next => { void this.schedule(next) }), 'remote-access: settings watcher')
    this.ctx.effect(() => this.ctx.webServer.register(createControlRoute(this, this.config.requestMaxBytes)), 'remote-access: control route')
    await this.schedule(this.scope.get())
  }

  /** Read secret-free configuration, runtime phase, and current authenticated links. */
  status(): RemoteAccessSnapshot {
    return {
      settings: settingsView(this.scope.get()),
      phase: this.phase,
      links: this.active?.proxy.links ?? [],
      ...(this.error === undefined ? {} : { error: this.error }),
    }
  }

  /** Persist editable fields and apply them to a running activation. */
  async update(request: RemoteAccessUpdate): Promise<RemoteAccessSnapshot> {
    if (request.serverToken !== undefined && request.clearServerToken === true) {
      throw new Error('serverToken and clearServerToken are mutually exclusive')
    }
    const patch: Record<string, unknown> = {}
    for (const key of ['mode', 'listenPort', 'serverAddr', 'serverPort', 'publicUrl'] as const) {
      if (request[key] !== undefined) patch[key] = request[key]
    }
    if (request.serverToken !== undefined) {
      if (request.serverToken.length === 0) throw new Error('serverToken must be non-empty')
      patch.serverToken = request.serverToken
    } else if (request.clearServerToken === true) {
      patch.serverToken = ''
    }
    await this.scope.update(patch)
    await this.schedule(this.scope.get())
    return this.status()
  }

  /** Persist enablement and start the selected remote path. */
  async enable(): Promise<RemoteAccessSnapshot> {
    await this.scope.update({ enabled: true })
    await this.schedule(this.scope.get())
    return this.status()
  }

  /** Persist disablement and revoke every current login link and cookie. */
  async disable(): Promise<RemoteAccessSnapshot> {
    await this.scope.update({ enabled: false })
    await this.schedule(this.scope.get())
    return this.status()
  }

  private schedule(settings: RemoteAccessSettings): Promise<void> {
    const run = this.operations.then(() => this.reconcile(settings))
    this.operations = run.catch(() => undefined)
    return run
  }

  private async reconcile(settings: RemoteAccessSettings): Promise<void> {
    if (this.disposed) return
    const nextFingerprint = fingerprint(settings)
    if (!settings.enabled) {
      await this.stopActive()
      this.phase = 'disabled'
      this.error = undefined
      return
    }
    if (this.active?.fingerprint === nextFingerprint) return
    this.phase = 'starting'
    this.error = undefined
    try {
      await this.stopActive()
      const publicBases = settings.mode === 'lan' ? lanBases(settings.listenPort) : [settings.publicUrl]
      if (publicBases.length === 0) throw new Error('no non-loopback IPv4 LAN address is available')
      const proxy = await startAuthenticatedProxy({
        bindHost: settings.mode === 'lan' ? '0.0.0.0' : '127.0.0.1',
        listenPort: settings.listenPort,
        upstreamPort: this.ctx.webServer.port,
        publicBases,
        secureCookie: settings.mode === 'tunnel' && settings.publicUrl.startsWith('https:'),
      })
      let frpc: FrpcHandle | undefined
      try {
        if (settings.mode === 'tunnel') {
          frpc = await startFrpc(this.ctx.subprocess, {
            executable: this.config.frpcPath,
            serverAddr: settings.serverAddr,
            serverPort: settings.serverPort,
            serverToken: settings.serverToken,
            localPort: proxy.port,
            publicUrl: settings.publicUrl,
            graceMs: this.config.processGraceMs,
            startupTimeoutMs: this.config.frpcStartupTimeoutMs,
            outputMaxBytes: this.config.frpcOutputMaxBytes,
          })
        }
      } catch (error) {
        await proxy.close()
        throw error
      }
      this.active = { fingerprint: nextFingerprint, proxy, ...(frpc === undefined ? {} : { frpc }) }
      this.phase = 'running'
      if (frpc !== undefined) {
        void frpc.done.catch((error: unknown) => { this.scheduleTunnelFailure(frpc, error) })
      }
    } catch (error) {
      this.phase = 'error'
      this.error = error instanceof Error ? error.message : String(error)
    }
  }

  private scheduleTunnelFailure(frpc: FrpcHandle, error: unknown): void {
    const run = this.operations.then(async () => {
      if (this.active?.frpc !== frpc) return
      try {
        await this.stopActive()
      } finally {
        this.phase = 'error'
        this.error = error instanceof Error ? error.message : String(error)
      }
    })
    this.operations = run.catch(() => undefined)
  }

  private async stopActive(): Promise<void> {
    const active = this.active
    this.active = undefined
    if (active === undefined) return
    const results = await Promise.allSettled([active.frpc?.close(), active.proxy.close()])
    const failure = results.find(result => result.status === 'rejected')
    if (failure?.status === 'rejected') throw failure.reason
  }
}

export default RemoteAccessGateway

/** Public configuration and status values for authenticated Web remote access. */

/** Network path exposed by the remote-access service. */
export type RemoteAccessMode = 'lan' | 'tunnel'

/** Durable settings owned by the remote-access plugin. */
export interface RemoteAccessSettings {
  /** Whether the authenticated remote listener should be running. */
  readonly enabled: boolean
  /** Direct LAN access or an frpc-backed public tunnel. */
  readonly mode: RemoteAccessMode
  /** Local authenticated-proxy port. */
  readonly listenPort: number
  /** frps control-plane hostname or IP address. */
  readonly serverAddr: string
  /** frps control-plane port. */
  readonly serverPort: number
  /** frps authentication token. */
  readonly serverToken: string
  /** Public HTTP or HTTPS URL routed by frps to this client. */
  readonly publicUrl: string
}

/** Secret-free settings returned to the browser. */
export interface RemoteAccessSettingsView extends Omit<RemoteAccessSettings, 'serverToken'> {
  /** Whether a non-empty frps token is stored. */
  readonly serverTokenConfigured: boolean
}

/** Runtime lifecycle exposed to the Settings page. */
export type RemoteAccessPhase = 'disabled' | 'starting' | 'running' | 'error'

/** Complete point-in-time remote-access view. */
export interface RemoteAccessSnapshot {
  readonly settings: RemoteAccessSettingsView
  readonly phase: RemoteAccessPhase
  /** Authenticated login links. Opening one exchanges its token for an HttpOnly cookie. */
  readonly links: readonly string[]
  /** Secret-free activation failure suitable for user presentation. */
  readonly error?: string
}

/** Partial settings mutation accepted by the Remote gateway. */
export interface RemoteAccessUpdate {
  readonly mode?: RemoteAccessMode
  readonly listenPort?: number
  readonly serverAddr?: string
  readonly serverPort?: number
  /** A non-empty value replaces the stored frps token. */
  readonly serverToken?: string
  /** Clear the stored frps token. Mutually exclusive with `serverToken`. */
  readonly clearServerToken?: boolean
  readonly publicUrl?: string
}

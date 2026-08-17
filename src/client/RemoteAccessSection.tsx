/** Remote Access settings page: durable configuration, lifecycle controls, and login links. */

import { useCallback, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import {
  Button, IconCheckOutline16, IconCopyOutline16, IconRefreshOutline16, Input, Tooltip, writeClipboard,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {
  RemoteAccessMode, RemoteAccessSnapshot, RemoteAccessUpdate,
} from '../types.ts'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import css from './RemoteAccessSection.module.css'

export interface RemoteAccessSectionInjected {
  readonly status: () => Promise<RemoteAccessSnapshot>
  readonly update: (request: RemoteAccessUpdate) => Promise<RemoteAccessSnapshot>
  readonly enable: () => Promise<RemoteAccessSnapshot>
  readonly disable: () => Promise<RemoteAccessSnapshot>
}

export type RemoteAccessSectionProps =
  PropsRuntime<'settings.section'>
  & PropsLocale<'settings.remoteAccess'>
  & RemoteAccessSectionInjected

interface Draft {
  mode: RemoteAccessMode
  listenPort: string
  serverAddr: string
  serverPort: string
  serverToken: string
  protocol: 'http' | 'https'
  publicAuthority: string
}

function draftOf(snapshot: RemoteAccessSnapshot): Draft {
  let protocol: Draft['protocol'] = 'https'
  let publicAuthority = ''
  if (snapshot.settings.publicUrl !== '') {
    try {
      const url = new URL(snapshot.settings.publicUrl)
      protocol = url.protocol === 'http:' ? 'http' : 'https'
      publicAuthority = url.host
    } catch {
      publicAuthority = snapshot.settings.publicUrl
    }
  }
  return {
    mode: snapshot.settings.mode,
    listenPort: String(snapshot.settings.listenPort),
    serverAddr: snapshot.settings.serverAddr,
    serverPort: String(snapshot.settings.serverPort),
    serverToken: '',
    protocol,
    publicAuthority,
  }
}

function phaseLabel(snapshot: RemoteAccessSnapshot, t: RemoteAccessSectionProps['t']): string {
  switch (snapshot.phase) {
    case 'disabled': return t('disabledStatus')
    case 'starting': return t('startingStatus')
    case 'running': return t('runningStatus')
    case 'error': return t('errorStatus')
    default: return assertNever(snapshot.phase)
  }
}

function assertNever(value: never): never {
  throw new Error(`unexpected remote-access phase: ${String(value)}`)
}

function updateOf(draft: Draft): RemoteAccessUpdate {
  return {
    mode: draft.mode,
    listenPort: Number(draft.listenPort),
    serverAddr: draft.serverAddr.trim(),
    serverPort: Number(draft.serverPort),
    ...(draft.serverToken === '' ? {} : { serverToken: draft.serverToken }),
    publicUrl: draft.publicAuthority.trim() === ''
      ? ''
      : `${draft.protocol}://${draft.publicAuthority.trim()}`,
  }
}

function Field(props: { label: string; children: ReactNode }): ReactNode {
  return (
    <label className={css.field}>
      <span className={css.fieldLabel}>{props.label}</span>
      {props.children}
    </label>
  )
}

/** Render the Remote Access settings section. */
export function RemoteAccessSection(props: RemoteAccessSectionProps): ReactNode {
  const { t } = props
  const [snapshot, setSnapshot] = useState<RemoteAccessSnapshot>()
  const [draft, setDraft] = useState<Draft>()
  const [busy, setBusy] = useState(false)
  const [loadError, setLoadError] = useState(false)
  const [actionError, setActionError] = useState(false)
  const [copied, setCopied] = useState<string>()

  const accept = useCallback((next: RemoteAccessSnapshot): void => {
    setSnapshot(next)
    setDraft(draftOf(next))
    setLoadError(false)
    setActionError(false)
  }, [])
  const load = useCallback((): void => {
    setLoadError(false)
    void props.status().then(accept, () => { setLoadError(true) })
  }, [accept, props.status])
  useEffect(() => { load() }, [load])

  const run = (operation: () => Promise<RemoteAccessSnapshot>): void => {
    setBusy(true)
    setActionError(false)
    void operation().then(accept, () => { setActionError(true) }).finally(() => { setBusy(false) })
  }

  if (snapshot === undefined || draft === undefined) {
    return (
      <section className={css.section} aria-label={t('title')}>
        {loadError
          ? <div className={css.center}><span role="alert">{t('loadFailed')}</span><Button onClick={load}>{t('refresh')}</Button></div>
          : <div className={css.center}>{t('loading')}</div>}
      </section>
    )
  }

  const enabled = snapshot.settings.enabled
  const set = <K extends keyof Draft>(key: K, value: Draft[K]): void => {
    setDraft(current => current === undefined ? current : { ...current, [key]: value })
  }
  const toggle = (): void => {
    if (enabled) {
      run(props.disable)
      return
    }
    run(async () => {
      await props.update(updateOf(draft))
      return props.enable()
    })
  }
  const save = (): void => { run(() => props.update(updateOf(draft))) }

  return (
    <section className={css.section} aria-label={t('title')}>
      <div className={css.topRow}>
        <div>
          <h2 className={css.title}>{t('title')}</h2>
          <span className={css.status} data-phase={snapshot.phase}>{phaseLabel(snapshot, t)}</span>
        </div>
        <label className={css.switchLabel}>
          <span>{t('enabled')}</span>
          <input className={css.switchInput} type="checkbox" checked={enabled} disabled={busy} onChange={toggle} />
          <span className={css.switchTrack} aria-hidden="true"><span /></span>
        </label>
      </div>

      <div className={css.form}>
        <div className={css.field}>
          <span className={css.fieldLabel}>{t('mode')}</span>
          <div className={css.segmented}>
            {(['lan', 'tunnel'] as const).map(mode => (
              <button key={mode} type="button" aria-pressed={draft.mode === mode} onClick={() => { set('mode', mode) }}>
                {t(mode)}
              </button>
            ))}
          </div>
        </div>

        <Field label={t('listenPort')}>
          <Input type="number" min="1" max="65535" value={draft.listenPort} onChange={event => { set('listenPort', event.target.value) }} />
        </Field>

        {draft.mode === 'tunnel' ? (
          <>
            <div className={css.twoColumns}>
              <Field label={t('serverAddr')}>
                <Input value={draft.serverAddr} onChange={event => { set('serverAddr', event.target.value) }} />
              </Field>
              <Field label={t('serverPort')}>
                <Input type="number" min="1" max="65535" value={draft.serverPort} onChange={event => { set('serverPort', event.target.value) }} />
              </Field>
            </div>
            <Field label={t('serverToken')}>
              <Input
                type="password"
                value={draft.serverToken}
                placeholder={snapshot.settings.serverTokenConfigured ? t('tokenConfigured') : ''}
                autoComplete="off"
                onChange={event => { set('serverToken', event.target.value) }}
              />
            </Field>
            <div className={css.twoColumnsWide}>
              <div className={css.field}>
                <span className={css.fieldLabel}>{t('publicProtocol')}</span>
                <div className={css.segmented}>
                  {(['http', 'https'] as const).map(protocol => (
                    <button key={protocol} type="button" aria-pressed={draft.protocol === protocol} onClick={() => { set('protocol', protocol) }}>
                      {protocol.toUpperCase()}
                    </button>
                  ))}
                </div>
              </div>
              <Field label={t('publicAuthority')}>
                <Input value={draft.publicAuthority} onChange={event => { set('publicAuthority', event.target.value) }} />
              </Field>
            </div>
          </>
        ) : null}

        <div className={css.actions}>
          <Button variant="primary" disabled={busy} onClick={save}>{busy ? t('saving') : t('save')}</Button>
          <Tooltip label={t('refresh')} side="top">
            <Button variant="toolbar" aria-label={t('refresh')} disabled={busy} onClick={load} icon={<IconRefreshOutline16 />} />
          </Tooltip>
        </div>
        {actionError ? <p className={css.error} role="alert">{t('actionFailed')}</p> : null}
        {snapshot.error !== undefined ? <p className={css.error} role="alert">{snapshot.error}</p> : null}
      </div>

      <div className={css.links}>
        <h3>{t('links')}</h3>
        {snapshot.links.length === 0 ? <p className={css.empty}>{t('noLinks')}</p> : (
          <ul>
            {snapshot.links.map(link => (
              <li key={link}>
                <code>{link}</code>
                <Tooltip label={copied === link ? t('copied') : t('copy')} side="top">
                  <button
                    type="button"
                    className={css.copyButton}
                    aria-label={copied === link ? t('copied') : t('copy')}
                    onClick={() => {
                      void writeClipboard(link).then((ok) => { setCopied(ok ? link : undefined) })
                    }}
                  >
                    {copied === link ? <IconCheckOutline16 /> : <IconCopyOutline16 />}
                  </button>
                </Tooltip>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  )
}

/** Remote Access settings-section registration, browser half. */

import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import { remoteAccessApi } from './api.ts'
import { RemoteAccessSection } from './RemoteAccessSection.tsx'
import { en, zh, type RemoteAccessLocaleKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    'settings.remoteAccess': RemoteAccessLocaleKey
  }
}

const NS = 'settings.remoteAccess'

/** Services required by the Settings registration. */
export const inject = ['slots', 'locale']

/** Register the localized Remote Access settings page. */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'remote-access: dictionaries')
  const t = ctx.locale.bind(NS)
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'remote-access',
    order: 20,
    label: () => t('nav'),
    locale: NS,
    inject: () => remoteAccessApi,
  }, RemoteAccessSection))
}

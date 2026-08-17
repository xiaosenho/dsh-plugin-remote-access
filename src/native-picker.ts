/** Cross-platform native file chooser for the host's frpc executable. */

import { runNativeCommand, type NativeCommandRunner } from '@deepseek-ai/dsh-native-command'

/** Injectable platform facts for deterministic picker tests. */
export interface FrpcPickerInternals {
  readonly platform?: NodeJS.Platform
  readonly run?: NativeCommandRunner
}

function outputPath(stdout: string): string | null {
  const path = stdout.replace(/[\r\n]+$/, '')
  return path === '' ? null : path
}

function errorCode(error: unknown): string | number | undefined {
  if (typeof error !== 'object' || error === null || !('code' in error)) return undefined
  const code = (error as { code?: unknown }).code
  return typeof code === 'string' || typeof code === 'number' ? code : undefined
}

function errorStderr(error: unknown): string {
  if (typeof error !== 'object' || error === null || !('stderr' in error)) return ''
  const stderr = (error as { stderr?: unknown }).stderr
  return typeof stderr === 'string' ? stderr : ''
}

function rethrowIfAborted(signal: AbortSignal, error: unknown): void {
  if (signal.aborted) throw error
}

/**
 * Open the host's native file chooser for an frpc executable.
 * @param signal - Browser request lifetime; abort terminates a command-backed chooser.
 * @param internals - Platform and runner hooks for deterministic tests.
 * @returns the selected host path, or null when the user cancels.
 */
export async function pickNativeFrpc(
  signal: AbortSignal,
  internals: FrpcPickerInternals = {},
): Promise<string | null> {
  const platform = internals.platform ?? process.platform
  const run = internals.run ?? runNativeCommand

  if (platform === 'darwin') {
    try {
      const result = await run('osascript', [
        '-e', 'set selectedFile to choose file with prompt "Select frpc Client"',
        '-e', 'POSIX path of selectedFile',
      ], signal)
      return outputPath(result.stdout)
    } catch (error: unknown) {
      if (!signal.aborted && errorCode(error) === 1
        && /(?:User canceled|-128)/i.test(errorStderr(error))) return null
      throw error
    }
  }

  if (platform === 'win32') {
    const script = [
      'Add-Type -AssemblyName System.Windows.Forms',
      '$dialog = New-Object System.Windows.Forms.OpenFileDialog',
      '$dialog.Title = "Select frpc Client"',
      '$dialog.Filter = "frpc executable (frpc.exe)|frpc.exe|Executable files (*.exe)|*.exe|All files (*.*)|*.*"',
      '$dialog.CheckFileExists = $true',
      'if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { Write-Output $dialog.FileName }',
    ].join('; ')
    const result = await run('powershell.exe', [
      '-NoLogo', '-NoProfile', '-NonInteractive', '-STA', '-Command', script,
    ], signal)
    return outputPath(result.stdout)
  }

  if (platform === 'linux') {
    try {
      const result = await run('zenity', [
        '--file-selection', '--title=Select frpc Client',
      ], signal)
      return outputPath(result.stdout)
    } catch (error: unknown) {
      rethrowIfAborted(signal, error)
      if (errorCode(error) === 1) return null
      if (errorCode(error) !== 'ENOENT') throw error
    }

    try {
      const result = await run('kdialog', [
        '--getopenfilename', '.', '--title', 'Select frpc Client',
      ], signal)
      return outputPath(result.stdout)
    } catch (error: unknown) {
      rethrowIfAborted(signal, error)
      if (errorCode(error) === 1) return null
      if (errorCode(error) === 'ENOENT') {
        throw new Error('no supported native file picker found (install zenity or kdialog)')
      }
      throw error
    }
  }

  throw new Error(`native frpc file picker is unsupported on ${platform}`)
}

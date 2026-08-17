import { describe, expect, it, vi } from 'vitest'
import type { NativeCommandRunner } from '@deepseek-ai/dsh-native-command'
import { pickNativeFrpc } from '../src/native-picker.ts'

function failure(code: string | number, stderr = ''): Error {
  return Object.assign(new Error(`command failed: ${String(code)}`), { code, stderr })
}

const signal = (): AbortSignal => new AbortController().signal

describe('native frpc picker', () => {
  it('uses the macOS file chooser and maps cancellation to null', async () => {
    const run = vi.fn<NativeCommandRunner>(async () => ({ stdout: '/opt/homebrew/bin/frpc\n', stderr: '' }))
    await expect(pickNativeFrpc(signal(), { platform: 'darwin', run })).resolves.toBe('/opt/homebrew/bin/frpc')
    expect(run).toHaveBeenCalledWith('osascript', expect.arrayContaining(['POSIX path of selectedFile']), expect.any(AbortSignal))

    run.mockRejectedValueOnce(failure(1, 'execution error: User canceled. (-128)'))
    await expect(pickNativeFrpc(signal(), { platform: 'darwin', run })).resolves.toBeNull()
  })

  it('uses the Windows executable chooser and maps an empty selection to null', async () => {
    const run = vi.fn<NativeCommandRunner>(async () => ({ stdout: 'C:\\tools\\frpc.exe\r\n', stderr: '' }))
    await expect(pickNativeFrpc(signal(), { platform: 'win32', run })).resolves.toBe('C:\\tools\\frpc.exe')
    expect(run).toHaveBeenCalledWith('powershell.exe', expect.arrayContaining(['-STA', '-Command']), expect.any(AbortSignal))

    run.mockResolvedValueOnce({ stdout: '', stderr: '' })
    await expect(pickNativeFrpc(signal(), { platform: 'win32', run })).resolves.toBeNull()
  })

  it('falls back from Zenity to KDialog only when Zenity is missing', async () => {
    const run = vi.fn<NativeCommandRunner>()
      .mockRejectedValueOnce(failure('ENOENT'))
      .mockResolvedValueOnce({ stdout: '/usr/local/bin/frpc\n', stderr: '' })
    await expect(pickNativeFrpc(signal(), { platform: 'linux', run })).resolves.toBe('/usr/local/bin/frpc')
    expect(run.mock.calls.map(call => call[0])).toEqual(['zenity', 'kdialog'])

    const cancelled = vi.fn<NativeCommandRunner>(async () => { throw failure(1) })
    await expect(pickNativeFrpc(signal(), { platform: 'linux', run: cancelled })).resolves.toBeNull()
  })

  it('reports missing Linux pickers, caller aborts, and unsupported platforms', async () => {
    const missing = vi.fn<NativeCommandRunner>(async () => { throw failure('ENOENT') })
    await expect(pickNativeFrpc(signal(), { platform: 'linux', run: missing }))
      .rejects.toThrow('install zenity or kdialog')

    const abort = new AbortController()
    abort.abort()
    const aborted = vi.fn<NativeCommandRunner>(async () => { throw failure('ABORT_ERR') })
    await expect(pickNativeFrpc(abort.signal, { platform: 'linux', run: aborted })).rejects.toThrow('command failed')
    await expect(pickNativeFrpc(signal(), { platform: 'aix' })).rejects.toThrow('unsupported on aix')
  })
})

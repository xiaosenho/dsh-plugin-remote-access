#!/usr/bin/env node
/**
 * Pre-publish validation for the remote-access bundle.
 *
 * Guarantees the Cordis composition patch and the client bundle only use
 * package names the final tarball can actually resolve, and that every
 * documented install command matches the published name. Runs before
 * `pack`/`publish` via the `prepack` lifecycle and standalone via
 * `pnpm run verify`.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, mkdirSync, rmSync, copyFileSync, readFileSync, writeFileSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const fail = (message) => {
  console.error(`verify-publish: ${message}`)
  process.exit(1)
}

const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))
const patch = readFileSync(join(ROOT, 'cordis.patch.yml'), 'utf8')

// 1. Every `name:` under an `- insert:` row must be the package's own name.
const insertNames = [...patch.matchAll(/^\s*name:\s*(.+)$/gm)].map((match) =>
  match[1].trim().replace(/^(['"])(.*)\1$/, '$2'),
)
if (insertNames.length === 0) fail('cordis.patch.yml has no `name:` rows under `- insert:`')
for (const name of insertNames) {
  if (name !== pkg.name) {
    fail(`cordis.patch.yml references "${name}" but package.json declares "${pkg.name}"`)
  }
}

// 2. The client bundle must register itself under the same scoped name, or the
//    module system's '/plugins/<id>/client.js' route never matches the
//    registration (the bare-name leak bit 0.1.3 in both places).
const clientBundles = []
for (const entry of pkg.files) {
  if (/^lib\/client.*\.(?:cjs|js)$/.test(entry) && existsSync(join(ROOT, entry))) clientBundles.push(entry)
}
for (const bundle of clientBundles) {
  const text = readFileSync(join(ROOT, bundle), 'utf8')
  const match = /__ModuleLoader__\.load\(\{\s*id:\s*["']([^"']+)["']/.exec(text)
  if (match === null) fail(`${bundle} has no __ModuleLoader__.load id to check`)
  if (match[1] !== pkg.name) {
    fail(`${bundle} registers client id "${match[1]}" but package.json declares "${pkg.name}"`)
  }
}

// 3. Documentation install commands must use the exact package name.
for (const readme of ['README.md', 'README.zh.md']) {
  const text = readFileSync(join(ROOT, readme), 'utf8')
  if (!text.includes(`dsh plugin --profile web add ${pkg.name}`)) {
    fail(`${readme} does not document \`dsh plugin --profile web add ${pkg.name}\``)
  }
}

// 4. Every shipped artifact named by the files list must exist.
for (const entry of pkg.files) {
  if (!existsSync(join(ROOT, entry))) fail(`files entry "${entry}" does not exist`)
}

// 5. Cordis loads the patch `name` as a bare ESM specifier from the profile
//    root. Simulate a fresh profile install and import that exact name.
const scratch = mkdtempSync(join(tmpdir(), 'remote-access-verify-'))
try {
  const profileDir = join(scratch, 'profiles', 'web')
  const installDir = join(profileDir, 'node_modules', ...pkg.name.split('/'))
  mkdirSync(installDir, { recursive: true })
  for (const entry of ['package.json', ...pkg.files]) {
    const source = join(ROOT, entry)
    const target = join(installDir, entry)
    mkdirSync(dirname(target), { recursive: true })
    copyFileSync(source, target)
  }
  // A real profile install would have pnpm resolve the package's runtime
  // dependencies into node_modules; mirror them from this repo's own install
  // so the import below resolves exactly like a fresh profile boot.
  const runtimeDeps = Object.keys({ ...(pkg.dependencies ?? {}), ...(pkg.peerDependencies ?? {}) })
  for (const dep of runtimeDeps) {
    const source = join(ROOT, 'node_modules', ...dep.split('/'))
    const target = join(profileDir, 'node_modules', ...dep.split('/'))
    if (existsSync(source)) {
      mkdirSync(dirname(target), { recursive: true })
      try {
        symlinkSync(source, target, process.platform === 'win32' ? 'junction' : 'dir')
      } catch {
        // already present from a previous dep in the loop
      }
    }
  }
  const importer = join(profileDir, '_resolve-check.mjs')
  writeFileSync(importer, `const mod = await import(process.argv[2])\nconst plugin = mod.default ?? mod\nif (plugin === null || plugin === undefined) { console.error('no plugin export'); process.exit(1) }\nconsole.log('ok:', process.argv[2], '-> plugin:', typeof plugin)\n`)
  execFileSync(process.execPath, [importer, pkg.name], { cwd: profileDir, stdio: 'inherit' })
} finally {
  rmSync(scratch, { recursive: true, force: true })
}

console.log(`verify-publish: ${pkg.name}@${pkg.version} patch names, client id, docs, files, and profile resolution all consistent`)

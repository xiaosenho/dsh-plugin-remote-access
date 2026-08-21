import { readFileSync } from 'node:fs'
import { basename, dirname, resolve } from 'node:path'
import { defineConfig } from 'tsdown'
import { transform } from 'lightningcss'

const PACKAGE_NAME = '@xiaosenho/dsh-plugin-remote-access'
const CSS_PREFIX = '\0remote-access-css:'
const CSS_SUFFIX = '.mjs'
const CLIENT_EXTERNALS = [
  'react',
  'react/jsx-runtime',
  '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-ui-primitives',
]

export default defineConfig([
  {
    name: PACKAGE_NAME,
    entry: { index: 'src/index.ts' },
    outDir: 'lib',
    format: 'esm',
    platform: 'node',
    target: 'es2024',
    fixedExtension: false,
    dts: true,
    clean: true,
  },
  {
    name: `${PACKAGE_NAME}/client`,
    entry: { client: 'src/client/index.ts' },
    outDir: 'lib',
    format: 'cjs',
    platform: 'browser',
    target: 'es2022',
    dts: false,
    sourcemap: true,
    clean: false,
    deps: {
      neverBundle: CLIENT_EXTERNALS,
      alwaysBundle: ['zod'],
      onlyBundle: ['zod'],
    },
    plugins: [{
      name: 'remote-access-css-modules',
      resolveId(source: string, importer: string | undefined) {
        if (!source.endsWith('.module.css') || importer === undefined) return null
        return CSS_PREFIX + resolve(dirname(importer), source) + CSS_SUFFIX
      },
      load(id: string) {
        if (!id.startsWith(CSS_PREFIX)) return null
        const filename = id.slice(CSS_PREFIX.length, -CSS_SUFFIX.length)
        const result = transform({
          filename,
          code: readFileSync(filename),
          cssModules: { pattern: '[hash]_[local]' },
          minify: true,
        })
        const classes: Record<string, string> = {}
        for (const [local, value] of Object.entries(result.exports ?? {})) classes[local] = value.name
        const tagId = `${PACKAGE_NAME}/${basename(filename)}`
        return [
          `const tagId = ${JSON.stringify(tagId)};`,
          `const css = ${JSON.stringify(result.code.toString())};`,
          "if (document.querySelector('style[data-plugin-css=' + JSON.stringify(tagId) + ']') === null) {",
          "  const tag = document.createElement('style');",
          `  tag.dataset.plugin = ${JSON.stringify(PACKAGE_NAME)};`,
          '  tag.dataset.pluginCss = tagId;',
          '  tag.textContent = css;',
          '  document.head.appendChild(tag);',
          '}',
          `export default ${JSON.stringify(classes)};`,
        ].join('\n')
      },
    }],
    outputOptions: {
      entryFileNames: 'client.cjs',
      banner: `window.__ModuleLoader__.load({ id: ${JSON.stringify(PACKAGE_NAME)}, factory: (require) => {`,
      footer: 'return module.exports; } });',
      intro: 'var module = { exports: {} }; var exports = module.exports;',
    },
  },
])

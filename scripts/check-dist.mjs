import { readdir, readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'

const forbidden = [
  /service[_-]?role/i,
  /sb_secret_/i,
  /database password/i,
  /JWT signing/i,
  /postgres:\/\/[^ ]+/i,
  /-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----/,
]
async function walk(path) {
  const entries = await readdir(path, { withFileTypes: true })
  for (const entry of entries) {
    const full = join(path, entry.name)
    if (entry.isDirectory()) await walk(full)
    else if (!entry.name.endsWith('.map')) {
      const text = await readFile(full, 'utf8')
      for (const pattern of forbidden) {
        if (pattern.test(text)) throw new Error(`Forbidden secret marker in ${full}: ${pattern}`)
      }
    }
  }
}
await stat('dist')
await walk('dist')
console.log('Artifact secret scan passed.')

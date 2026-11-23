import { readdir, readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'

const forbidden = [
  /\bsb_secret_[A-Za-z0-9_-]{20,}\b/i,
  /\b(?:service[_-]?role|serviceRole)\b[^\n]{0,80}["']?[A-Za-z0-9_-]{40,}["']?/i,
  /\b(?:postgres(?:ql)?|mysql|redis):\/\/[^:\s/@]+:[^@\s/]+@[^\s"'`]+/i,
  /-----BEGIN (?:RSA |EC |DSA |OPENSSH |ENCRYPTED )?PRIVATE KEY-----/,
]

const jwtPattern = /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g

function hasPrivilegedJwt(text) {
  for (const match of text.matchAll(jwtPattern)) {
    try {
      const payload = match[0].split('.')[1].replace(/-/g, '+').replace(/_/g, '/')
      const decoded = JSON.parse(Buffer.from(payload, 'base64').toString('utf8'))
      if (decoded.role === 'service_role' || decoded.role === 'supabase_admin') return true
    } catch {
      // A malformed/non-Supabase JWT is not a credential match.
    }
  }
  return false
}

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
      if (hasPrivilegedJwt(text)) {
        throw new Error(`Forbidden privileged Supabase JWT in ${full}`)
      }
    }
  }
}
await stat('dist')
await walk('dist')
console.log('Artifact secret scan passed.')

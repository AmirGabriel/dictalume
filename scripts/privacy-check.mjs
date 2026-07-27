import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'

const files = execFileSync(
  'git',
  ['ls-files', '--cached', '--others', '--exclude-standard', '-z'],
  { encoding: 'utf8' }
)
  .split('\0')
  .filter(Boolean)

const forbiddenFiles = /(^|\/)(?:\.env(?:\..+)?|settings|history|meetings|calendar|sync|context)\.json$/i
const secretPatterns = [
  ['OpenAI-style API key', new RegExp(`(?:s${'k'}|x${'ai'})-[A-Za-z0-9_-]{16,}`)],
  ['Groq API key', new RegExp(`g${'sk'}_[A-Za-z0-9_-]{16,}`)],
  ['Google API credential', new RegExp(`AI${'za'}[0-9A-Za-z_-]{20,}`)],
  [
    'Google OAuth client ID',
    new RegExp(`[0-9]+-[A-Za-z0-9_-]+\\.apps\\.googleusercontent\\.${'com'}`)
  ],
  ['private key', new RegExp(`-----BEGIN [A-Z ]+PRIVATE ${'KEY'}-----`)],
  ['populated Apple Team ID', /DEVELOPMENT_TEAM\s*[:=]\s*["']?[A-Z0-9]{10}/],
  ['absolute home-directory path', new RegExp(escapeRegExp(`${homedir()}/`))]
]

const findings = []

for (const file of files) {
  if (forbiddenFiles.test(file)) {
    findings.push(`${file}: forbidden runtime or credential file`)
    continue
  }

  const buffer = readFileSync(file)
  if (buffer.includes(0)) continue
  const content = buffer.toString('utf8')

  for (const [label, pattern] of secretPatterns) {
    if (pattern.test(content)) findings.push(`${file}: possible ${label}`)
  }

  if (
    file !== 'pnpm-lock.yaml' &&
    /(?:^|[\s("'`])[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}(?:$|[\s)"'`,])/m.test(content)
  ) {
    findings.push(`${file}: possible personal email address`)
  }
}

if (findings.length > 0) {
  process.stderr.write('Privacy check failed. Review these paths without committing them:\n')
  for (const finding of [...new Set(findings)]) process.stderr.write(`- ${finding}\n`)
  process.exit(1)
}

process.stdout.write(`Privacy check passed for ${files.length} publishable files.\n`)

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

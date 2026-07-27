import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { migrateLegacyUserData } from './migration'

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((path) =>
      rm(path, { recursive: true, force: true })
    )
  )
})

describe('legacy application data migration', () => {
  it('copies existing user data without overwriting current files', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dictalume-migration-'))
    temporaryDirectories.push(root)
    const legacy = join(root, 'WhisperType')
    const current = join(root, 'Dictalume')
    await mkdir(legacy)
    await mkdir(current)
    await writeFile(join(legacy, 'settings.json'), '{"source":"legacy"}')
    await writeFile(join(legacy, 'history.json'), '["legacy"]')
    await writeFile(join(current, 'settings.json'), '{"source":"current"}')

    const migrated = await migrateLegacyUserData(current, [legacy])

    expect(migrated).toEqual(['history.json'])
    expect(await readFile(join(current, 'settings.json'), 'utf8')).toContain('current')
    expect(await readFile(join(current, 'history.json'), 'utf8')).toContain('legacy')
  })
})

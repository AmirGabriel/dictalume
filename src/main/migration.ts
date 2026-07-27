import { access, copyFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'

const USER_DATA_FILES = [
  'settings.json',
  'history.json',
  'meetings.json',
  'calendar.json',
  'sync.json'
]

async function exists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

export async function migrateLegacyUserData(
  currentDirectory: string,
  legacyDirectories: string[]
): Promise<string[]> {
  await mkdir(currentDirectory, { recursive: true })
  const migrated: string[] = []

  for (const file of USER_DATA_FILES) {
    const target = join(currentDirectory, file)
    if (await exists(target)) continue

    for (const legacyDirectory of legacyDirectories) {
      const source = join(legacyDirectory, file)
      if (!(await exists(source))) continue
      await copyFile(source, target)
      migrated.push(file)
      break
    }
  }

  return migrated
}

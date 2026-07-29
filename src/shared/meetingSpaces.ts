import type { MeetingRecord, MeetingSpace } from './types'

export function normalizedSpaceTitle(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLocaleLowerCase()
}

export function sanitizeMeetingSpaces(spaces: MeetingSpace[]): MeetingSpace[] {
  const result: MeetingSpace[] = []
  const seenIds = new Set<string>()
  for (const candidate of spaces.slice(0, 200)) {
    const id = candidate.id?.trim().slice(0, 80)
    const name = candidate.name?.trim().replace(/\s+/g, ' ').slice(0, 80)
    if (!id || !name || seenIds.has(id)) continue
    seenIds.add(id)
    result.push({
      id,
      name,
      description: (candidate.description || '').trim().slice(0, 500),
      icon: (candidate.icon || '📁').trim().slice(0, 8) || '📁',
      autoAddTitles: Array.from(
        new Set(
          (candidate.autoAddTitles || [])
            .map((title) => title.trim().replace(/\s+/g, ' ').slice(0, 160))
            .filter(Boolean)
        )
      ).slice(0, 50),
      ...(candidate.parentId?.trim()
        ? { parentId: candidate.parentId.trim().slice(0, 80) }
        : {})
    })
  }
  const validIds = new Set(result.map((space) => space.id))
  const withValidParents = result.map((space) => ({
    ...space,
    ...(space.parentId && validIds.has(space.parentId) && space.parentId !== space.id
      ? { parentId: space.parentId }
      : { parentId: undefined })
  }))
  const byId = new Map(withValidParents.map((space) => [space.id, space]))
  return withValidParents.map((space) => {
    const visited = new Set([space.id])
    let parentId = space.parentId
    while (parentId) {
      if (visited.has(parentId)) return { ...space, parentId: undefined }
      visited.add(parentId)
      parentId = byId.get(parentId)?.parentId
    }
    return space
  })
}

export function spacePath(space: MeetingSpace, spaces: MeetingSpace[]): string {
  const byId = new Map(spaces.map((item) => [item.id, item]))
  const names = [space.name]
  const visited = new Set([space.id])
  let parentId = space.parentId
  while (parentId && !visited.has(parentId) && names.length < 10) {
    visited.add(parentId)
    const parent = byId.get(parentId)
    if (!parent) break
    names.unshift(parent.name)
    parentId = parent.parentId
  }
  return names.join(' / ')
}

export function descendantSpaceIds(spaceId: string, spaces: MeetingSpace[]): Set<string> {
  const descendants = new Set([spaceId])
  let changed = true
  while (changed) {
    changed = false
    for (const space of spaces) {
      if (space.parentId && descendants.has(space.parentId) && !descendants.has(space.id)) {
        descendants.add(space.id)
        changed = true
      }
    }
  }
  return descendants
}

export function meetingSpaceIds(
  meeting: MeetingRecord,
  spaces: MeetingSpace[]
): string[] {
  const validIds = new Set(spaces.map((space) => space.id))
  const explicit = (meeting.spaceIds || []).filter((id) => validIds.has(id))
  if (explicit.length > 0 || !meeting.space?.trim()) return explicit
  const legacyName = normalizedSpaceTitle(meeting.space)
  const match = spaces.find(
    (space) => normalizedSpaceTitle(space.name) === legacyName
  )
  return match ? [match.id] : []
}

export function automaticallyAssignedSpaceIds(
  meetingTitle: string,
  calendarSeriesId: string | undefined,
  spaces: MeetingSpace[]
): string[] {
  const normalizedTitle = normalizedSpaceTitle(meetingTitle)
  return spaces
    .filter((space) =>
      space.autoAddTitles.some(
        (title) => normalizedSpaceTitle(title) === normalizedTitle
      ) ||
      Boolean(
        calendarSeriesId &&
        space.autoAddTitles.some(
          (title) => title === `series:${calendarSeriesId}`
        )
      )
    )
    .map((space) => space.id)
}

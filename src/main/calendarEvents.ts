import type { CalendarEvent } from '../shared/types'

export interface GoogleCalendarEvent {
  id?: string
  summary?: string
  description?: string
  location?: string
  hangoutLink?: string
  start?: { dateTime?: string; date?: string }
  end?: { dateTime?: string; date?: string }
  conferenceData?: {
    entryPoints?: Array<{ entryPointType?: string; uri?: string }>
  }
}

export function extractMeetingUrl(event: GoogleCalendarEvent): string {
  const video = event.conferenceData?.entryPoints?.find(
    (entry) => entry.entryPointType === 'video' && entry.uri?.startsWith('https://')
  )?.uri
  if (video) return video
  if (event.hangoutLink?.startsWith('https://')) return event.hangoutLink

  const text = `${event.location || ''}\n${event.description || ''}`
  const zoom =
    text.match(
      /https:\/\/(?:[\w-]+\.)?(?:zoom\.us|zoomgov\.com)\/(?:j|s|my)\/[^\s<>"']+/i
    )?.[0] || ''
  if (zoom) return zoom.replace(/[),.;]+$/, '')
  return text.match(/https:\/\/meet\.google\.com\/[a-z0-9-]+/i)?.[0] || ''
}

export function normalizeCalendarEvent(event: GoogleCalendarEvent): CalendarEvent | null {
  if (!event.id || !event.start || !event.end) return null
  const startsAt = Date.parse(event.start.dateTime || event.start.date || '')
  const endsAt = Date.parse(event.end.dateTime || event.end.date || '')
  if (!Number.isFinite(startsAt) || !Number.isFinite(endsAt)) return null
  const joinUrl = extractMeetingUrl(event)
  return {
    id: event.id,
    title: event.summary || 'Untitled event',
    startsAt,
    endsAt,
    joinUrl,
    provider: joinUrl.includes('meet.google.com')
      ? 'google-meet'
      : /zoom(?:gov)?\.com|zoom\.us/i.test(joinUrl)
        ? 'zoom'
        : 'other'
  }
}

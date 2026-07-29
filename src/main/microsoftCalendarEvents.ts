import type { CalendarEvent } from '../shared/types'

export interface MicrosoftCalendarEvent {
  id?: string
  seriesMasterId?: string
  subject?: string
  bodyPreview?: string
  start?: { dateTime?: string; timeZone?: string }
  end?: { dateTime?: string; timeZone?: string }
  onlineMeeting?: { joinUrl?: string }
  onlineMeetingUrl?: string
  location?: { displayName?: string }
  attendees?: Array<{
    emailAddress?: { name?: string; address?: string }
    status?: { response?: string }
    type?: string
  }>
}

function microsoftDate(value?: string): number {
  if (!value) return Number.NaN
  // Graph returns a timezone-free value when Prefer: outlook.timezone="UTC" is used.
  const normalized = /(?:Z|[+-]\d\d:\d\d)$/.test(value) ? value : `${value}Z`
  return Date.parse(normalized)
}

export function normalizeMicrosoftCalendarEvent(
  event: MicrosoftCalendarEvent
): CalendarEvent | null {
  if (!event.id) return null
  const startsAt = microsoftDate(event.start?.dateTime)
  const endsAt = microsoftDate(event.end?.dateTime)
  if (!Number.isFinite(startsAt) || !Number.isFinite(endsAt)) return null
  const text = [
    event.onlineMeeting?.joinUrl,
    event.onlineMeetingUrl,
    event.location?.displayName,
    event.bodyPreview
  ].filter(Boolean).join('\n')
  const joinUrl =
    text.match(/https:\/\/(?:[\w-]+\.)?zoom\.us\/(?:j|s|my)\/[^\s<>"']+/i)?.[0] ||
    text.match(/https:\/\/meet\.google\.com\/[a-z0-9-]+/i)?.[0] ||
    text.match(/https:\/\/teams\.microsoft\.com\/l\/meetup-join\/[^\s<>"']+/i)?.[0] ||
    ''
  return {
    id: `microsoft:${event.id}`,
    ...(event.seriesMasterId
      ? { seriesId: `microsoft:${event.seriesMasterId}` }
      : {}),
    title: event.subject || 'Untitled event',
    startsAt,
    endsAt,
    joinUrl: joinUrl.replace(/[),.;]+$/, ''),
    provider: joinUrl.includes('meet.google.com')
      ? 'google-meet'
      : /zoom\.us/i.test(joinUrl)
        ? 'zoom'
        : 'other',
    attendees: (event.attendees || [])
      .filter(
        (attendee) =>
          attendee.type !== 'resource' &&
          Boolean(attendee.emailAddress?.name || attendee.emailAddress?.address)
      )
      .map((attendee) => ({
        name:
          attendee.emailAddress?.name ||
          attendee.emailAddress?.address ||
          'Unknown attendee',
        ...(attendee.emailAddress?.address
          ? { email: attendee.emailAddress.address }
          : {}),
        ...(
          ['accepted', 'declined', 'tentative', 'needsAction'].includes(
            attendee.status?.response || ''
          )
            ? {
                responseStatus: attendee.status!.response as
                  | 'accepted'
                  | 'declined'
                  | 'tentative'
                  | 'needsAction'
              }
            : {}
        )
      }))
  }
}

import { describe, expect, it } from 'vitest'
import { extractMeetingUrl, normalizeCalendarEvent } from './calendarEvents'

describe('calendar meeting links', () => {
  it('prefers the official Google Calendar video entry point', () => {
    expect(
      extractMeetingUrl({
        hangoutLink: 'https://meet.google.com/fallback-link',
        conferenceData: {
          entryPoints: [
            { entryPointType: 'phone', uri: 'tel:+551100000000' },
            { entryPointType: 'video', uri: 'https://meet.google.com/abc-defg-hij' }
          ]
        }
      })
    ).toBe('https://meet.google.com/abc-defg-hij')
  })

  it('finds Zoom links in HTML descriptions without trailing markup', () => {
    expect(
      extractMeetingUrl({
        description:
          'Join <a href="https://acme.zoom.us/j/123456789?pwd=abc123">Zoom meeting</a>.'
      })
    ).toBe('https://acme.zoom.us/j/123456789?pwd=abc123')
  })

  it('supports Zoom government and personal-room links', () => {
    expect(
      extractMeetingUrl({
        location: 'https://agency.zoomgov.com/my/product-team'
      })
    ).toBe('https://agency.zoomgov.com/my/product-team')
  })

  it('normalizes an upcoming event for the meeting picker', () => {
    const event = normalizeCalendarEvent({
      id: 'event-1',
      summary: 'Weekly review',
      start: { dateTime: '2026-07-27T10:00:00-03:00' },
      end: { dateTime: '2026-07-27T10:30:00-03:00' },
      hangoutLink: 'https://meet.google.com/abc-defg-hij'
    })

    expect(event).toMatchObject({
      id: 'event-1',
      title: 'Weekly review',
      provider: 'google-meet'
    })
    expect(event?.endsAt).toBeGreaterThan(event?.startsAt || 0)
  })

  it('rejects malformed events instead of rendering invalid dates', () => {
    expect(
      normalizeCalendarEvent({
        id: 'bad-event',
        start: { dateTime: 'not-a-date' },
        end: { dateTime: 'also-not-a-date' }
      })
    ).toBeNull()
  })
})

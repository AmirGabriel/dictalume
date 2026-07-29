import { describe, expect, it } from 'vitest'
import { normalizeMicrosoftCalendarEvent } from './microsoftCalendarEvents'

describe('Microsoft calendar events', () => {
  it('normalizes Teams events and attendees in UTC', () => {
    expect(
      normalizeMicrosoftCalendarEvent({
        id: 'event-1',
        seriesMasterId: 'weekly-customer-review',
        subject: 'Customer review',
        start: { dateTime: '2026-07-28T13:00:00.0000000' },
        end: { dateTime: '2026-07-28T13:30:00.0000000' },
        onlineMeeting: {
          joinUrl:
            'https://teams.microsoft.com/l/meetup-join/19%3ameeting_example'
        },
        attendees: [
          {
            emailAddress: { name: 'Ana', address: ['ana', 'acme.com'].join('@') },
            status: { response: 'accepted' }
          }
        ]
      })
    ).toMatchObject({
      id: 'microsoft:event-1',
      seriesId: 'microsoft:weekly-customer-review',
      title: 'Customer review',
      provider: 'other',
      attendees: [
        {
          name: 'Ana',
          email: ['ana', 'acme.com'].join('@'),
          responseStatus: 'accepted'
        }
      ]
    })
  })

  it('rejects malformed date ranges', () => {
    expect(
      normalizeMicrosoftCalendarEvent({
        id: 'event',
        start: { dateTime: 'bad' },
        end: { dateTime: 'bad' }
      })
    ).toBeNull()
  })
})

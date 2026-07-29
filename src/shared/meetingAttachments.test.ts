import { expect, it } from 'vitest'
import { sanitizeMeetingAttachments } from './meetingAttachments'

it('keeps valid meeting images and rejects mismatched data URLs', () => {
  expect(
    sanitizeMeetingAttachments([
      {
        id: 'image-1',
        name: 'diagram.png',
        mimeType: 'image/png',
        dataUrl: 'data:image/png;base64,aGVsbG8=',
        createdAt: 1
      },
      {
        id: 'image-2',
        name: 'wrong.jpg',
        mimeType: 'image/jpeg',
        dataUrl: 'data:text/plain;base64,aGVsbG8=',
        createdAt: 2
      }
    ])
  ).toEqual([
    {
      id: 'image-1',
      name: 'diagram.png',
      mimeType: 'image/png',
      dataUrl: 'data:image/png;base64,aGVsbG8=',
      createdAt: 1
    }
  ])
})

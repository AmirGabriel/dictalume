import type { MeetingAttachment } from './types'

const allowedImageTypes = new Set<MeetingAttachment['mimeType']>([
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif'
])

const maxImageBytes = 5 * 1024 * 1024
const maxTotalBytes = 20 * 1024 * 1024

function approximateDataBytes(dataUrl: string): number {
  const comma = dataUrl.indexOf(',')
  return comma === -1 ? Number.POSITIVE_INFINITY : Math.ceil((dataUrl.length - comma - 1) * 0.75)
}

export function sanitizeMeetingAttachments(
  attachments: MeetingAttachment[]
): MeetingAttachment[] {
  const sanitized: MeetingAttachment[] = []
  const seenIds = new Set<string>()
  let totalBytes = 0
  for (const attachment of attachments.slice(0, 20)) {
    const id = attachment.id?.trim().slice(0, 80)
    const mimeType = attachment.mimeType
    const expectedPrefix = `data:${mimeType};base64,`
    const bytes = approximateDataBytes(attachment.dataUrl || '')
    if (
      !id ||
      seenIds.has(id) ||
      !allowedImageTypes.has(mimeType) ||
      !attachment.dataUrl?.startsWith(expectedPrefix) ||
      bytes > maxImageBytes ||
      totalBytes + bytes > maxTotalBytes
    ) {
      continue
    }
    seenIds.add(id)
    totalBytes += bytes
    sanitized.push({
      id,
      name: (attachment.name || 'Meeting image').trim().slice(0, 160),
      mimeType,
      dataUrl: attachment.dataUrl,
      createdAt: Number.isFinite(attachment.createdAt)
        ? attachment.createdAt
        : Date.now()
    })
  }
  return sanitized
}

const SPEAKING_ATTRIBUTES = [
  '[data-is-speaking="true"]',
  '[data-speaking="true"]',
  '[data-active-speaker="true"]'
]

const NAME_SELECTORS = [
  '[data-participant-name]',
  '[data-self-name]',
  '.zWGUib',
  '[class*="participant-name"]',
  '[class*="display-name"]'
]

function cleanName(value) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .replace(/\b(?:is speaking|speaking|está falando|falando)\b[.!]?$/iu, '')
    .trim()
    .slice(0, 80)
}

function nameFromElement(element) {
  const tile = element.closest(
    '[data-participant-id], [data-requested-participant-id], [role="listitem"]'
  ) || element
  for (const attribute of ['data-participant-name', 'data-self-name']) {
    const name = cleanName(tile.getAttribute?.(attribute))
    if (name) return name
  }
  for (const selector of NAME_SELECTORS) {
    const candidate = tile.matches?.(selector) ? tile : tile.querySelector?.(selector)
    const name = cleanName(
      candidate?.getAttribute?.('data-participant-name') ||
      candidate?.getAttribute?.('data-self-name') ||
      candidate?.textContent
    )
    if (name) return name
  }
  const aria = cleanName(tile.getAttribute?.('aria-label'))
  return /\b(?:is speaking|speaking|está falando|falando)\b/iu.test(
    tile.getAttribute?.('aria-label') || ''
  )
    ? aria
    : ''
}

function activeSpeakerName() {
  for (const selector of SPEAKING_ATTRIBUTES) {
    for (const element of document.querySelectorAll(selector)) {
      const name = nameFromElement(element)
      if (name) return name
    }
  }
  for (const element of document.querySelectorAll('[aria-label]')) {
    const label = element.getAttribute('aria-label') || ''
    if (!/\b(?:is speaking|está falando)\b[.!]?$/iu.test(label)) continue
    const name = nameFromElement(element)
    if (name) return name
  }
  return ''
}

function publish() {
  const name = activeSpeakerName()
  if (!name) return
  chrome.runtime.sendMessage({
    type: 'speaker-active',
    name,
    meetingUrl: location.href
  })
}

setInterval(publish, 750)
publish()

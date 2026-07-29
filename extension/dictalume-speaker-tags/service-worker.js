const BRIDGE_URL = 'ws://127.0.0.1:43127'
let socket = null
let reconnectTimer = null
let queuedEvent = null

function connect() {
  if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) {
    return
  }
  clearTimeout(reconnectTimer)
  socket = new WebSocket(BRIDGE_URL)
  socket.addEventListener('open', () => {
    if (queuedEvent) {
      socket.send(JSON.stringify(queuedEvent))
      queuedEvent = null
    }
  })
  socket.addEventListener('close', () => {
    socket = null
    reconnectTimer = setTimeout(connect, 1500)
  })
  socket.addEventListener('error', () => socket?.close())
}

chrome.runtime.onMessage.addListener((message) => {
  if (
    !message ||
    message.type !== 'speaker-active' ||
    typeof message.name !== 'string' ||
    typeof message.meetingUrl !== 'string'
  ) {
    return
  }
  const event = {
    type: 'speaker-active',
    name: message.name,
    capturedAt: Date.now(),
    meetingUrl: message.meetingUrl
  }
  if (socket?.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(event))
  } else {
    queuedEvent = event
    connect()
  }
})

connect()

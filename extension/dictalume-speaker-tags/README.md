# Dictalume Speaker Tags

This optional Chromium extension reads only the participant name and active-speaker signal
already visible in a Google Meet tab. It does not capture audio, video, captions, chat,
page contents, or browsing history.

It sends a short heartbeat (`name`, timestamp, and Meet URL) to Dictalume through a
WebSocket bound to `127.0.0.1:43127`. The bridge accepts browser-extension origins only
and is not exposed to the network.

## Install locally

1. Open `chrome://extensions` in Chrome, Edge, Arc, or Brave.
2. Enable **Developer mode**.
3. Click **Load unpacked**.
4. Select this `dictalume-speaker-tags` folder.
5. Keep Dictalume running and open a Google Meet tab.

The Meetings page reports **Connected** when the extension reaches the local app.

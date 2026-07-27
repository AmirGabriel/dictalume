import { afterEach, describe, expect, it, vi } from 'vitest'
import { defaultSettings } from './defaults'
import {
  cleanupTranscript,
  createMeetingNotes,
  transcribeAudio,
  transcribeDeepgram,
  transcribeGrok,
  transcribeOpenAICompatible
} from './providers'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('transcription providers', () => {
  it('sends an OpenAI-compatible multipart transcription request', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ text: 'hello from the microphone' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      })
    )

    const text = await transcribeOpenAICompatible(
      new Uint8Array([1, 2, 3]),
      'audio/webm',
      { ...defaultSettings.providers.openai, apiKey: 'test-key' },
      'en'
    )

    expect(text).toBe('hello from the microphone')
    expect(fetchMock).toHaveBeenCalledOnce()
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://api.openai.com/v1/audio/transcriptions')
    expect(init?.headers).toEqual({ Authorization: 'Bearer test-key' })
    const form = init?.body as FormData
    expect(form.get('model')).toBe('gpt-4o-mini-transcribe')
    expect(form.get('language')).toBe('en')
    expect(form.get('file')).toBeInstanceOf(Blob)
  })

  it('sends raw audio to Deepgram with detection enabled', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          results: {
            channels: [{ alternatives: [{ transcript: 'deep gram result' }] }]
          }
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    )

    const text = await transcribeDeepgram(
      new Uint8Array([4, 5, 6]),
      'audio/webm',
      { ...defaultSettings.providers.deepgram, apiKey: 'deep-key' },
      'auto'
    )

    expect(text).toBe('deep gram result')
    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).toContain('detect_language=true')
    expect(init?.headers).toEqual({
      Authorization: 'Token deep-key',
      'Content-Type': 'audio/webm'
    })
  })

  it('uses the xAI Grok speech-to-text endpoint and keyterms', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ text: 'hello from grok' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      })
    )

    const text = await transcribeGrok(
      new Uint8Array([7, 8, 9]),
      'audio/webm',
      { ...defaultSettings.providers.grok, apiKey: 'xai-key' },
      'en',
      'Dictalume\nGrok'
    )

    expect(text).toBe('hello from grok')
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://api.x.ai/v1/stt')
    expect(init?.headers).toEqual({ Authorization: 'Bearer xai-key' })
    const form = init?.body as FormData
    expect(form.get('language')).toBe('en')
    expect(form.get('format')).toBe('true')
    expect(form.getAll('keyterm')).toEqual(['Dictalume', 'Grok'])
    expect(form.get('file')).toBeInstanceOf(Blob)
  })

  it('keeps the transcript when optional cleanup fails', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('nope', { status: 500 }))
    const settings = structuredClone(defaultSettings)
    settings.providers.openai.apiKey = 'test-key'

    await expect(cleanupTranscript('keep this text', settings)).resolves.toBe(
      'keep this text'
    )
  })

  it('includes only the enabled captured context in cleanup', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({ choices: [{ message: { content: 'clean result' } }] }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    )
    const settings = structuredClone(defaultSettings)
    settings.providers.openai.apiKey = 'test-key'

    const result = await cleanupTranscript('spoken request', settings, {
      application: 'Cursor\nworkspace.ts',
      selectedText: 'const answer = 41',
      clipboard: 'copied reference'
    })

    expect(result).toBe('clean result')
    const init = fetchMock.mock.calls[0][1]
    const body = JSON.parse(String(init?.body)) as {
      messages: Array<{ role: string; content: string }>
    }
    expect(body.messages[1].content).toContain('User Message:\nspoken request')
    expect(body.messages[1].content).toContain('Application Context:\nCursor')
    expect(body.messages[1].content).toContain('Selected Text:\nconst answer = 41')
    expect(body.messages[1].content).toContain('Clipboard Context:\ncopied reference')
  })

  it('applies a newly learned spelling to the current cleanup request', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
    fetchMock
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ text: 'Use nix. Write it like N-I-X.' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ choices: [{ message: { content: 'Use NIX.' } }] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        })
      )

    const settings = structuredClone(defaultSettings)
    settings.providers.openai.apiKey = 'test-key'
    const result = await transcribeAudio(
      new Uint8Array([1, 2, 3]),
      'audio/webm',
      settings
    )

    expect(result.text).toBe('Use NIX.')
    expect(result.learnedVocabulary).toEqual(['NIX'])
    const cleanupBody = JSON.parse(String(fetchMock.mock.calls[1][1]?.body)) as {
      messages: Array<{ content: string }>
    }
    expect(cleanupBody.messages[1].content).toContain(
      'NIX — learned from your spelling'
    )
  })

  it('asks the cleanup model for summary bullets and pending tasks only', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [{
            message: {
              content: '## Summary\n- Scope approved.\n\n## To-do list\n- [ ] Ana — send the brief.'
            }
          }]
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    )
    const settings = structuredClone(defaultSettings)
    settings.providers.openai.apiKey = 'test-key'

    const notes = await createMeetingNotes(
      'Ana agreed to send the brief.',
      settings,
      'Planning'
    )

    expect(notes).toContain('## Summary')
    const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body)) as {
      messages: Array<{ content: string }>
    }
    expect(body.messages[0].content).toContain('## To-do list')
    expect(body.messages[0].content).toContain('Do not include the full transcript')
    expect(body.messages[1].content).toContain('Meeting: Planning')
  })

  it('returns an actionable summary placeholder when cleanup is unavailable', async () => {
    const settings = structuredClone(defaultSettings)
    await expect(
      createMeetingNotes('Raw transcript.', settings, 'Meeting')
    ).resolves.toContain('Configure a cleanup provider')
  })
})

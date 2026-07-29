import { afterEach, describe, expect, it, vi } from 'vitest'
import { defaultSettings } from './defaults'
import {
  cleanupTranscript,
  answerMeetingQuestion,
  createMeetingNotes,
  createMeetingNotesWithEvidence,
  extractMeetingNoteEvidence,
  FAITHFUL_CLEANUP_POLICY,
  isFaithfulCleanup,
  transcribeAudio,
  transcribeDeepgram,
  transcribeGrok,
  transcribeMeetingAudio,
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

  it('returns Deepgram diarization labels as meeting evidence', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          metadata: { duration: 4 },
          results: {
            utterances: [
              { start: 0.2, end: 1.8, speaker: 0, transcript: 'First speaker.' },
              { start: 2, end: 3.7, speaker: 1, transcript: 'Second speaker.' }
            ]
          }
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    )
    const settings = structuredClone(defaultSettings)
    settings.provider = 'deepgram'
    settings.providers.deepgram.apiKey = 'test-key'

    const result = await transcribeMeetingAudio(
      new Uint8Array([1, 2, 3]),
      'audio/webm',
      settings,
      'system',
      true,
      undefined,
      4_000
    )

    expect(result.chunks).toEqual([
      {
        text: 'First speaker.',
        startMs: 200,
        endMs: 1800,
        diarizationLabel: 'speaker-0'
      },
      {
        text: 'Second speaker.',
        startMs: 2000,
        endMs: 3700,
        diarizationLabel: 'speaker-1'
      }
    ])
    expect(String(fetchMock.mock.calls[0][0])).toContain('diarize=true')
    expect(String(fetchMock.mock.calls[0][0])).toContain('utterances=true')
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
    const keyterms = form.getAll('keyterm')
    expect(keyterms.slice(0, 2)).toEqual(['Dictalume', 'Grok'])
    expect(keyterms).toContain('HTML')
    expect(keyterms).toContain('IPS')
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

  it('disables reasoning and uses a stable cache route for fast Grok cleanup', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({ choices: [{ message: { content: 'Texto preservado.' } }] }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    )
    const settings = structuredClone(defaultSettings)
    settings.provider = 'grok'
    settings.providers.grok.apiKey = 'xai-key'

    await cleanupTranscript('texto preservado', settings)

    const init = fetchMock.mock.calls[0][1]
    const body = JSON.parse(String(init?.body)) as { reasoning_effort?: string }
    expect(body.reasoning_effort).toBe('none')
    expect(init?.headers).toMatchObject({
      'x-grok-conv-id': 'dictalume-transcript-cleanup-v1'
    })
  })

  it('includes only the enabled captured context in cleanup', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({ choices: [{ message: { content: 'Spoken request.' } }] }),
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

    expect(result).toBe('Spoken request.')
    const init = fetchMock.mock.calls[0][1]
    const body = JSON.parse(String(init?.body)) as {
      messages: Array<{ role: string; content: string }>
    }
    expect(body.messages[1].content).toContain('User Message:\nspoken request')
    expect(body.messages[1].content).toContain('Application Context:\nCursor')
    expect(body.messages[1].content).toContain('Selected Text:\nconst answer = 41')
    expect(body.messages[1].content).toContain('Clipboard Context:\ncopied reference')
    expect(body.messages[0].content).toContain(FAITHFUL_CLEANUP_POLICY)
    expect(JSON.parse(String(init?.body)).temperature).toBe(0)
  })

  it('rejects cleanup output that silently drops transcript information', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [{ message: { content: 'The launch was discussed.' } }]
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    )
    const settings = structuredClone(defaultSettings)
    settings.providers.openai.apiKey = 'test-key'
    const raw =
      'We agreed to launch NIX 4.2 on Tuesday, keep Windows support, retain the offline mode, and ask Ana to verify the installer before noon.'

    await expect(cleanupTranscript(raw, settings)).resolves.toBe(raw)
  })

  it('allows an explicit spoken deletion while retaining the remaining message', () => {
    expect(
      isFaithfulCleanup(
        'Vamos lançar na terça. Apaga a frase anterior. Precisamos revisar o instalador amanhã.',
        'Precisamos revisar o instalador amanhã.'
      )
    ).toBe(true)
  })

  it('does not treat ordinary use of “remove” as a transcript-edit command', () => {
    expect(
      isFaithfulCleanup(
        'We need to remove access for Ana tomorrow and preserve audit logs.',
        'We need access for Ana tomorrow and preserve audit logs.'
      )
    ).toBe(false)
  })

  it('rejects a polished-looking summary that keeps keywords but drops detail', () => {
    expect(
      isFaithfulCleanup(
        'Precisamos manter o suporte no Windows, testar o instalador com a Ana amanhã cedo e documentar o fluxo de rollback antes do lançamento para o time de operações.',
        'Precisamos manter o suporte no Windows e preparar o lançamento.'
      )
    ).toBe(false)
  })

  it('rejects cleanup that adds unsourced implementation details', () => {
    expect(
      isFaithfulCleanup(
        'Precisamos revisar o instalador do Windows amanhã com a Ana antes do lançamento e registrar qualquer problema encontrado durante o teste.',
        'Precisamos revisar o instalador do Windows amanhã com a Ana antes do lançamento, usar um pipeline Kubernetes, configurar AWS Lambda e registrar qualquer problema encontrado durante o teste.'
      )
    ).toBe(false)
  })

  it('allows only close corrections to known technical keyterms', () => {
    expect(
      isFaithfulCleanup(
        'Vamos atualizar o HTMI e revisar o painel OPS.',
        'Vamos atualizar o HTML e revisar o painel IPS.'
      )
    ).toBe(true)
    expect(
      isFaithfulCleanup(
        'Vamos revisar o PS antes do deploy.',
        'Vamos revisar o IPS antes do deploy.'
      )
    ).toBe(true)
    expect(
      isFaithfulCleanup(
        'A versão 4.2 sai amanhã às 14:30.',
        'A versão sai amanhã.'
      )
    ).toBe(false)
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

  it('asks for structured notes without guessing speaker identities', async () => {
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
    expect(body.messages[0].content).toContain('never infer, swap, merge, or guess')
    expect(body.messages[0].content).toContain('Do not append the full transcript')
    expect(body.messages[1].content).toContain('Meeting: Planning')
    expect(body.messages[1].content).toContain('Authoritative speaker-labelled transcript')
  })

  it('returns an actionable summary placeholder when cleanup is unavailable', async () => {
    const settings = structuredClone(defaultSettings)
    await expect(
      createMeetingNotes('Raw transcript.', settings, 'Meeting')
    ).resolves.toContain('Configure a cleanup provider')
  })

  it('keeps only real transcript-turn evidence and removes hidden markers from notes', () => {
    expect(
      extractMeetingNoteEvidence(
        [
          '## Summary',
          '- Scope approved. <!-- evidence:turn-1, invented-turn -->',
          '- Launch is Friday. <!-- evidence:invented-turn -->'
        ].join('\n'),
        new Set(['turn-1'])
      )
    ).toEqual({
      notes: '## Summary\n- Scope approved.\n- Launch is Friday.',
      evidence: [{ noteText: 'Scope approved.', turnIds: ['turn-1'] }]
    })
  })

  it('asks the notes model to cite supplied transcript turn IDs', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [{
            message: {
              content: '## Decisions\n- Ship Friday. <!-- evidence:turn-a -->'
            }
          }]
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    )
    const settings = structuredClone(defaultSettings)
    settings.providers.openai.apiKey = 'test-key'

    await expect(
      createMeetingNotesWithEvidence(
        '[00:00] Ana: Ship Friday.',
        settings,
        'Planning',
        undefined,
        undefined,
        {
          evidencePassages: [{ turnId: 'turn-a', text: 'Ana: Ship Friday.' }]
        }
      )
    ).resolves.toEqual({
      notes: '## Decisions\n- Ship Friday.',
      evidence: [{ noteText: 'Ship Friday.', turnIds: ['turn-a'] }]
    })
    const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body)) as {
      messages: Array<{ content: string }>
    }
    expect(body.messages[0].content).toContain('<!-- evidence:TURN_ID -->')
    expect(body.messages[1].content).toContain('[turn-a] Ana: Ship Friday.')
  })

  it('answers meeting questions with the selected provider and existing API key', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [{ message: { content: 'Ana owns the follow-up.' } }],
          usage: { input_tokens: 100, output_tokens: 10, cost_in_usd_ticks: 120_000 }
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    )
    const settings = structuredClone(defaultSettings)
    settings.providers.grok.apiKey = 'existing-xai-key'
    const usages: unknown[] = []

    const answer = await answerMeetingQuestion(
      'Ana agreed to send the brief.',
      '## Summary\n- Ana owns the follow-up.',
      [],
      'Who owns the follow-up?',
      settings,
      'grok',
      undefined,
      (usage) => {
        usages.push(usage)
      }
    )

    expect(answer).toBe('Ana owns the follow-up.')
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://api.x.ai/v1/chat/completions')
    expect(init?.headers).toMatchObject({ Authorization: 'Bearer existing-xai-key' })
    expect(usages).toHaveLength(1)
  })
})

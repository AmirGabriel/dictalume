import type { AppSettings, ContextSnapshot, ProviderConfig } from '../shared/types'
import { extractSpellingMemories, mergeVocabulary } from './memory'

export class TranscriptionError extends Error {
  constructor(
    message: string,
    public readonly status?: number
  ) {
    super(message)
    this.name = 'TranscriptionError'
  }
}

function extensionForMime(mimeType: string): string {
  if (mimeType.includes('mp4')) return 'm4a'
  if (mimeType.includes('ogg')) return 'ogg'
  if (mimeType.includes('wav')) return 'wav'
  return 'webm'
}

function asArrayBuffer(audio: Uint8Array): ArrayBuffer {
  return audio.buffer.slice(
    audio.byteOffset,
    audio.byteOffset + audio.byteLength
  ) as ArrayBuffer
}

async function responseError(response: Response): Promise<never> {
  let detail = ''
  try {
    const body = (await response.json()) as {
      error?: { message?: string } | string
      message?: string
    }
    detail =
      typeof body.error === 'string'
        ? body.error
        : body.error?.message || body.message || ''
  } catch {
    detail = await response.text().catch(() => '')
  }
  throw new TranscriptionError(
    detail || `The provider returned HTTP ${response.status}.`,
    response.status
  )
}

export async function transcribeOpenAICompatible(
  audio: Uint8Array,
  mimeType: string,
  provider: ProviderConfig,
  language: string,
  vocabulary = '',
  signal?: AbortSignal
): Promise<string> {
  if (!provider.apiKey && !provider.baseUrl.includes('localhost')) {
    throw new TranscriptionError(`Add an API key for ${provider.name} in Providers.`)
  }

  const body = new FormData()
  body.append(
    'file',
    new Blob([asArrayBuffer(audio)], { type: mimeType }),
    `recording.${extensionForMime(mimeType)}`
  )
  body.append('model', provider.model)
  if (language !== 'auto') body.append('language', language)
  if (vocabulary.trim()) body.append('prompt', vocabulary.trim())

  const response = await fetch(`${provider.baseUrl.replace(/\/$/, '')}/audio/transcriptions`, {
    method: 'POST',
    headers: provider.apiKey ? { Authorization: `Bearer ${provider.apiKey}` } : undefined,
    body,
    signal
  })
  if (!response.ok) return responseError(response)
  const result = (await response.json()) as { text?: string }
  if (!result.text?.trim()) throw new TranscriptionError('The provider returned an empty transcript.')
  return result.text.trim()
}

export async function transcribeGrok(
  audio: Uint8Array,
  mimeType: string,
  provider: ProviderConfig,
  language: string,
  vocabulary = '',
  signal?: AbortSignal
): Promise<string> {
  if (!provider.apiKey) {
    throw new TranscriptionError('Add an xAI API key for Grok in Providers.')
  }

  // xAI requires every option to precede the file in the multipart body.
  const body = new FormData()
  if (language !== 'auto') {
    body.append('language', language)
    body.append('format', 'true')
  }
  vocabulary
    .split('\n')
    .map((term) => term.trim())
    .filter(Boolean)
    .slice(0, 100)
    .forEach((term) => body.append('keyterm', term.slice(0, 50)))
  body.append(
    'file',
    new Blob([asArrayBuffer(audio)], { type: mimeType }),
    `recording.${extensionForMime(mimeType)}`
  )

  const response = await fetch(`${provider.baseUrl.replace(/\/$/, '')}/stt`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${provider.apiKey}` },
    body,
    signal
  })
  if (!response.ok) return responseError(response)
  const result = (await response.json()) as { text?: string }
  if (!result.text?.trim()) throw new TranscriptionError('Grok returned an empty transcript.')
  return result.text.trim()
}

export async function transcribeDeepgram(
  audio: Uint8Array,
  mimeType: string,
  provider: ProviderConfig,
  language: string,
  vocabulary = '',
  signal?: AbortSignal
): Promise<string> {
  if (!provider.apiKey) throw new TranscriptionError('Add a Deepgram API key in Providers.')
  const query = new URLSearchParams({
    model: provider.model,
    smart_format: 'true',
    punctuate: 'true'
  })
  if (language !== 'auto') query.set('language', language)
  else query.set('detect_language', 'true')
  vocabulary
    .split('\n')
    .map((term) => term.trim())
    .filter(Boolean)
    .slice(0, 100)
    .forEach((term) => query.append('keyterm', term))

  const response = await fetch(
    `${provider.baseUrl.replace(/\/$/, '')}/v1/listen?${query.toString()}`,
    {
      method: 'POST',
      headers: {
        Authorization: `Token ${provider.apiKey}`,
        'Content-Type': mimeType
      },
      body: asArrayBuffer(audio),
      signal
    }
  )
  if (!response.ok) return responseError(response)
  const result = (await response.json()) as {
    results?: { channels?: Array<{ alternatives?: Array<{ transcript?: string }> }> }
  }
  const text = result.results?.channels?.[0]?.alternatives?.[0]?.transcript?.trim()
  if (!text) throw new TranscriptionError('Deepgram returned an empty transcript.')
  return text
}

export async function cleanupTranscript(
  transcript: string,
  settings: AppSettings,
  context?: ContextSnapshot,
  signal?: AbortSignal
): Promise<string> {
  const mode = settings.modes[settings.mode]
  if (!mode.cleanup || !mode.prompt.trim()) return transcript

  const cleanupProviderId =
    settings.cleanupProvider === 'same' ? settings.provider : settings.cleanupProvider
  const provider = settings.providers[cleanupProviderId]
  if (cleanupProviderId === 'deepgram') return transcript
  if (!provider.apiKey && !provider.baseUrl.includes('localhost')) return transcript

  const response = await fetch(`${provider.baseUrl.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(provider.apiKey ? { Authorization: `Bearer ${provider.apiKey}` } : {})
    },
    body: JSON.stringify({
      model: provider.cleanupModel,
      temperature: 0.2,
      messages: [
        { role: 'system', content: mode.prompt },
        {
          role: 'user',
          content: [
            `User Message:\n${transcript}`,
            context?.application ? `Application Context:\n${context.application}` : '',
            context?.selectedText ? `Selected Text:\n${context.selectedText}` : '',
            context?.clipboard ? `Clipboard Context:\n${context.clipboard}` : '',
            settings.vocabulary.trim()
              ? `Preferred Vocabulary and Spellings:\n${settings.vocabulary.trim()}`
              : ''
          ]
            .filter(Boolean)
            .join('\n\n')
        }
      ]
    }),
    signal
  })

  if (!response.ok) {
    // Cleanup is an enhancement; never discard a successful transcript.
    return transcript
  }
  const result = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>
  }
  return result.choices?.[0]?.message?.content?.trim() || transcript
}

export async function transcribeAudio(
  audio: Uint8Array,
  mimeType: string,
  settings: AppSettings,
  context?: ContextSnapshot,
  signal?: AbortSignal
): Promise<{ text: string; rawText: string; learnedVocabulary: string[] }> {
  const provider = settings.providers[settings.provider]
  const rawText =
    settings.provider === 'deepgram'
      ? await transcribeDeepgram(
          audio,
          mimeType,
          provider,
          settings.language,
          settings.vocabulary,
          signal
        )
      : settings.provider === 'grok'
        ? await transcribeGrok(
            audio,
            mimeType,
            provider,
            settings.language,
            settings.vocabulary,
            signal
          )
        : await transcribeOpenAICompatible(
          audio,
          mimeType,
          provider,
          settings.language,
          settings.vocabulary,
          signal
        )
  const learnedVocabulary = settings.automaticMemory
    ? extractSpellingMemories(rawText)
    : []
  const settingsWithMemory =
    learnedVocabulary.length > 0
      ? {
          ...settings,
          vocabulary: mergeVocabulary(settings.vocabulary, learnedVocabulary)
        }
      : settings
  const text = await cleanupTranscript(rawText, settingsWithMemory, context, signal)
  return { text, rawText, learnedVocabulary }
}

export async function createMeetingNotes(
  transcript: string,
  settings: AppSettings,
  title: string,
  signal?: AbortSignal
): Promise<string> {
  const fallback =
    '## Summary\n- AI summary unavailable. Configure a cleanup provider to generate meeting notes.'
  const cleanupProviderId =
    settings.cleanupProvider === 'same' ? settings.provider : settings.cleanupProvider
  const provider = settings.providers[cleanupProviderId]
  if (cleanupProviderId === 'deepgram' || (!provider.apiKey && !provider.baseUrl.includes('localhost'))) {
    return fallback
  }

  const response = await fetch(`${provider.baseUrl.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(provider.apiKey ? { Authorization: `Bearer ${provider.apiKey}` } : {})
    },
    body: JSON.stringify({
      model: provider.cleanupModel,
      temperature: 0.15,
      messages: [
        {
          role: 'system',
          content:
            'Create Notion-style meeting notes in the same language as the transcript. Return only clean Markdown. Always start with "## Summary" containing 3–8 concise bullet points that capture the discussion, key decisions, and important context. Add "## To-do list" only when the transcript contains explicit pending work, commitments, or follow-ups; format every task as an unchecked Markdown checkbox and include the owner and due date only when they were actually stated. Do not invent tasks, owners, deadlines, decisions, or facts. Preserve names, technical terms, numbers, and preferred spellings. Do not include the full transcript because the app appends it separately.'
        },
        {
          role: 'user',
          content: [
            `Meeting: ${title || 'Untitled meeting'}`,
            settings.vocabulary.trim()
              ? `Preferred vocabulary:\n${settings.vocabulary.trim()}`
              : '',
            `Transcript:\n${transcript}`
          ]
            .filter(Boolean)
            .join('\n\n')
        }
      ]
    }),
    signal
  })

  if (!response.ok) return fallback
  const result = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>
  }
  return result.choices?.[0]?.message?.content?.trim() || fallback
}

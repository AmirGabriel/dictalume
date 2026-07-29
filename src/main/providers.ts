import type {
  AppSettings,
  ContextSnapshot,
  MeetingAudioSegment,
  MeetingNoteEvidence,
  MeetingRecord,
  MeetingTranscriptChunk,
  ProviderConfig
} from '../shared/types'
import {
  extractSpellingMemories,
  mergeVocabulary,
  observeAutomaticTermMemories,
  vocabularyKeyterms
} from './memory'
import {
  audioUsageMeasurement,
  textUsageMeasurement,
  type UsageSink
} from './apiUsage'

interface ApiResponseUsage {
  prompt_tokens?: number
  completion_tokens?: number
  input_tokens?: number
  output_tokens?: number
  prompt_tokens_details?: { cached_tokens?: number }
  input_tokens_details?: { cached_tokens?: number; audio_tokens?: number; text_tokens?: number }
  cost_in_usd_ticks?: number
}

export const FAITHFUL_CLEANUP_POLICY = [
  'You are a lossless transcript editor. The transcript is the source of truth.',
  'Allowed edits only: (1) clean punctuation and casing, (2) correct grammar without changing meaning, (3) remove filler and exact or near-verbatim repetition, and (4) execute an explicit spoken self-editing command such as “delete the previous sentence,” removing both that command and only the text it targets.',
  'Preserve every fact, idea, example, request, constraint, caveat, qualification, uncertainty, name, number, filename, technical term, and the order needed to retain the speaker’s intent.',
  'Never summarize, paraphrase for brevity, reinterpret, infer, answer the speaker, turn their speech into a different kind of document, add information from context, or silently omit a detail.',
  'Application, selection, clipboard, and vocabulary context may clarify spelling or references only. Never copy information from context into the transcript unless the speaker said it.',
  'The mode guidance below is subordinate to these rules. If it conflicts with source fidelity, ignore it.',
  'Keep the language and tone the speaker used. If unsure about an edit, preserve the original wording.',
  'Return only the edited transcript.'
].join(' ')

const cleanupStopWords = new Set([
  'a', 'as', 'ao', 'aos', 'e', 'é', 'em', 'eu', 'um', 'uma', 'uns', 'umas', 'o', 'os',
  'de', 'da', 'das', 'do', 'dos', 'que', 'se', 'no', 'na', 'nos', 'nas', 'pra', 'para',
  'por', 'com', 'como', 'isso', 'isto', 'então', 'tipo', 'né', 'assim', 'the', 'and',
  'or', 'to', 'of', 'in', 'on', 'for', 'with', 'that', 'this', 'it', 'is', 'are', 'was',
  'were', 'be', 'i', 'we', 'you', 'so', 'like', 'well', 'just', 'really', 'actually'
])

const automaticTermObservations = new Map<string, number>()

function normalizedContentTerms(text: string): Set<string> {
  const normalized = text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLocaleLowerCase()
  const terms = normalized.match(/[\p{L}\p{N}_./@%+-]+/gu) || []
  return new Set(
    terms
      .map((term) => term.replace(/[.,!?]+$/, ''))
      .filter((term) => term.length >= 3 && !cleanupStopWords.has(term))
      .map((term) => (term.length > 6 ? term.slice(0, 6) : term))
  )
}

function protectedDetails(text: string): string[] {
  const matches = text.match(
    /https?:\/\/\S+|[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}|(?:^|[\s(])(?:\d[\d.,:/%-]*|[A-Z]{2,}|[\w-]+\.[A-Za-z0-9]{1,8})(?=$|[\s),.!?])/g
  ) || []
  return Array.from(
    new Set(matches.map((value) => value.trim().replace(/[),.!?]+$/, '')))
  )
}

function editDistance(left: string, right: string): number {
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index)
  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    const current = [leftIndex]
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      current[rightIndex] = Math.min(
        current[rightIndex - 1] + 1,
        previous[rightIndex] + 1,
        previous[rightIndex - 1] +
          (left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1)
      )
    }
    previous.splice(0, previous.length, ...current)
  }
  return previous[right.length]
}

function technicalCorrection(
  detail: string,
  cleaned: string,
  preferredVocabulary: string
): string | null {
  if (!/^[A-Z]{2,12}$/.test(detail)) return null
  const cleanedTokens = new Set(
    (cleaned.match(/\b[A-Za-z]{2,12}\b/g) || []).map((term) =>
      term.toLocaleUpperCase()
    )
  )
  return (
    vocabularyKeyterms(preferredVocabulary).find((term) => {
      const candidate = term.toLocaleUpperCase()
      return (
        /^[A-Z]{2,12}$/.test(candidate) &&
        cleanedTokens.has(candidate) &&
        Math.abs(candidate.length - detail.length) <= 1 &&
        (
          editDistance(detail, candidate) <= 1 ||
          (
            candidate.length === detail.length &&
            candidate.slice(0, 2) === detail.slice(0, 2) &&
            editDistance(detail, candidate) <= 2
          )
        )
      )
    }) || null
  )
}

function hasExplicitSelfEdit(text: string): boolean {
  return /\b(?:apag(?:a|ue|ar)|remov(?:a|e|er)|exclu(?:a|i|ir)|delet(?:a|e|ar)|tira(?:r)?|retira(?:r)?|delete|remove|erase|strike|cut)\b[^.!?\n]{0,48}\b(?:frase|senten[cç]a|palavra|parte|trecho|anterior|[uú]ltim[oa]|isso|isto|que eu (?:disse|falei)|previous|last|sentence|word|part|passage|that|what i (?:said|spoke))\b/iu.test(
    text
  )
}

function hasExplicitSpellingInstruction(text: string): boolean {
  return /\b(spell(?:ed|ing)?|write it|written|escrev[ae]|soletr[ae])\b/iu.test(text)
}

export function isFaithfulCleanup(
  original: string,
  cleaned: string,
  preferredVocabulary = ''
): boolean {
  if (!cleaned.trim()) return false
  const originalTerms = normalizedContentTerms(original)
  const cleanedTerms = normalizedContentTerms(cleaned)
  const explicitSelfEdit = hasExplicitSelfEdit(original)
  const controlledRemoval = explicitSelfEdit || hasExplicitSpellingInstruction(original)

  if (!controlledRemoval) {
    const normalizedCleaned = cleaned.toLocaleLowerCase()
    if (
      protectedDetails(original).some(
        (detail) => {
          const correction = technicalCorrection(detail, cleaned, preferredVocabulary)
          return (
            !normalizedCleaned.includes(detail.toLocaleLowerCase()) &&
            !correction
          )
        }
      )
    ) {
      return false
    }

    const originalWordCount = original.match(/[\p{L}\p{N}]+/gu)?.length || 0
    const cleanedWordCount = cleaned.match(/[\p{L}\p{N}]+/gu)?.length || 0
    if (originalWordCount >= 8 && cleanedWordCount / originalWordCount < 0.58) {
      return false
    }
  }

  if (originalTerms.size < 6) return true
  if (controlledRemoval) {
    if (cleanedTerms.size === 0) return false
    const sourcedOutput = Array.from(cleanedTerms).filter((term) => originalTerms.has(term)).length
    return sourcedOutput / cleanedTerms.size >= 0.72
  }
  const correctionAliases = new Map<string, string>()
  for (const detail of protectedDetails(original)) {
    const correction = technicalCorrection(detail, cleaned, preferredVocabulary)
    if (correction) {
      correctionAliases.set(
        detail.toLocaleLowerCase().slice(0, 6),
        correction.toLocaleLowerCase().slice(0, 6)
      )
    }
  }
  const retained = Array.from(originalTerms).filter(
    (term) =>
      cleanedTerms.has(term) ||
      (correctionAliases.has(term) && cleanedTerms.has(correctionAliases.get(term)!))
  ).length
  const correctedOutputs = new Set(correctionAliases.values())
  const sourcedOutput = Array.from(cleanedTerms).filter(
    (term) => originalTerms.has(term) || correctedOutputs.has(term)
  ).length
  return (
    retained / originalTerms.size >= 0.9 &&
    (cleanedTerms.size === 0 || sourcedOutput / cleanedTerms.size >= 0.85)
  )
}

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
  signal?: AbortSignal,
  durationMs = 0,
  onUsage?: UsageSink
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
  if (provider.id === 'groq') body.append('response_format', 'verbose_json')
  if (language !== 'auto') body.append('language', language)
  if (vocabulary.trim()) body.append('prompt', vocabulary.trim())

  const response = await fetch(`${provider.baseUrl.replace(/\/$/, '')}/audio/transcriptions`, {
    method: 'POST',
    headers: provider.apiKey ? { Authorization: `Bearer ${provider.apiKey}` } : undefined,
    body,
    signal
  })
  if (!response.ok) return responseError(response)
  const result = (await response.json()) as { text?: string; duration?: number; usage?: ApiResponseUsage }
  if (!result.text?.trim()) throw new TranscriptionError('The provider returned an empty transcript.')
  await onUsage?.(
    audioUsageMeasurement(
      provider.id,
      provider.model,
      result.duration ?? durationMs / 1000,
      result.usage
    )
  )
  return result.text.trim()
}

export async function transcribeGrok(
  audio: Uint8Array,
  mimeType: string,
  provider: ProviderConfig,
  language: string,
  vocabulary = '',
  signal?: AbortSignal,
  durationMs = 0,
  onUsage?: UsageSink
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
  vocabularyKeyterms(vocabulary).forEach((term) => body.append('keyterm', term))
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
  const result = (await response.json()) as {
    text?: string
    duration?: number
    usage?: ApiResponseUsage
  }
  if (!result.text?.trim()) throw new TranscriptionError('Grok returned an empty transcript.')
  await onUsage?.(
    audioUsageMeasurement(
      provider.id,
      'speech-to-text',
      result.duration ?? durationMs / 1000,
      result.usage
    )
  )
  return result.text.trim()
}

export async function transcribeDeepgram(
  audio: Uint8Array,
  mimeType: string,
  provider: ProviderConfig,
  language: string,
  vocabulary = '',
  signal?: AbortSignal,
  durationMs = 0,
  onUsage?: UsageSink
): Promise<string> {
  if (!provider.apiKey) throw new TranscriptionError('Add a Deepgram API key in Providers.')
  const query = new URLSearchParams({
    model: provider.model,
    smart_format: 'true',
    punctuate: 'true'
  })
  if (language !== 'auto') query.set('language', language)
  else query.set('detect_language', 'true')
  vocabularyKeyterms(vocabulary).forEach((term) => query.append('keyterm', term))

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
    metadata?: { duration?: number }
    results?: { channels?: Array<{ alternatives?: Array<{ transcript?: string }> }> }
  }
  const text = result.results?.channels?.[0]?.alternatives?.[0]?.transcript?.trim()
  if (!text) throw new TranscriptionError('Deepgram returned an empty transcript.')
  await onUsage?.(
    audioUsageMeasurement(
      provider.id,
      provider.model,
      result.metadata?.duration ?? durationMs / 1000,
      undefined,
      vocabulary.trim() ? 0.078 : 0,
      language === 'auto' ? 0.552 : 0.462
    )
  )
  return text
}

export interface MeetingAudioTranscription {
  chunks: MeetingTranscriptChunk[]
  learnedVocabulary: string[]
}

async function transcribeDeepgramMeeting(
  audio: Uint8Array,
  mimeType: string,
  provider: ProviderConfig,
  language: string,
  vocabulary: string,
  diarize: boolean,
  signal?: AbortSignal,
  durationMs = 0,
  onUsage?: UsageSink
): Promise<MeetingTranscriptChunk[]> {
  if (!provider.apiKey) throw new TranscriptionError('Add a Deepgram API key in Providers.')
  const query = new URLSearchParams({
    model: provider.model,
    smart_format: 'true',
    punctuate: 'true',
    utterances: 'true',
    diarize: diarize ? 'true' : 'false'
  })
  if (language !== 'auto') query.set('language', language)
  else query.set('detect_language', 'true')
  vocabularyKeyterms(vocabulary).forEach((term) => query.append('keyterm', term))

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
    metadata?: { duration?: number }
    results?: {
      utterances?: Array<{
        start?: number
        end?: number
        speaker?: number
        transcript?: string
      }>
      channels?: Array<{ alternatives?: Array<{ transcript?: string }> }>
    }
  }
  await onUsage?.(
    audioUsageMeasurement(
      provider.id,
      provider.model,
      result.metadata?.duration ?? durationMs / 1000,
      undefined,
      vocabulary.trim() ? 0.078 : 0,
      language === 'auto' ? 0.552 : 0.462
    )
  )

  const utterances = (result.results?.utterances || [])
    .filter((utterance) => utterance.transcript?.trim())
    .map((utterance) => ({
      text: utterance.transcript!.trim(),
      startMs: Math.max(0, Math.round((utterance.start || 0) * 1000)),
      endMs: Math.max(0, Math.round((utterance.end || 0) * 1000)),
      ...(typeof utterance.speaker === 'number'
        ? { diarizationLabel: `speaker-${utterance.speaker}` }
        : {})
    }))
  if (utterances.length > 0) return utterances

  const text = result.results?.channels?.[0]?.alternatives?.[0]?.transcript?.trim()
  if (!text) throw new TranscriptionError('Deepgram returned an empty transcript.')
  return [{ text, startMs: 0, endMs: durationMs }]
}

/**
 * Meeting transcription intentionally returns source-relative chunks instead of a
 * polished paragraph. Speaker/source identity is evidence and must survive the AI
 * note-generation step unchanged.
 */
export async function transcribeMeetingAudio(
  audio: Uint8Array,
  mimeType: string,
  settings: AppSettings,
  source: MeetingAudioSegment['source'],
  diarize: boolean,
  signal?: AbortSignal,
  durationMs = 0,
  onUsage?: UsageSink
): Promise<MeetingAudioTranscription> {
  const provider = settings.providers[settings.provider]
  const chunks =
    settings.provider === 'deepgram'
      ? await transcribeDeepgramMeeting(
          audio,
          mimeType,
          provider,
          settings.language,
          settings.vocabulary,
          diarize,
          signal,
          durationMs,
          onUsage
        )
      : [
          {
            text:
              settings.provider === 'grok'
                ? await transcribeGrok(
                    audio,
                    mimeType,
                    provider,
                    settings.language,
                    settings.vocabulary,
                    signal,
                    durationMs,
                    onUsage
                  )
                : await transcribeOpenAICompatible(
                    audio,
                    mimeType,
                    provider,
                    settings.language,
                    settings.vocabulary,
                    signal,
                    durationMs,
                    onUsage
                  ),
            startMs: 0,
            endMs: durationMs
          }
        ]
  const rawText = chunks.map((chunk) => chunk.text).join(' ')
  return {
    chunks,
    learnedVocabulary: settings.automaticMemory ? extractSpellingMemories(rawText) : []
  }
}

export async function cleanupTranscript(
  transcript: string,
  settings: AppSettings,
  context?: ContextSnapshot,
  signal?: AbortSignal,
  onUsage?: UsageSink
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
      ...(provider.apiKey ? { Authorization: `Bearer ${provider.apiKey}` } : {}),
      ...(cleanupProviderId === 'grok'
        ? { 'x-grok-conv-id': 'dictalume-transcript-cleanup-v1' }
        : {})
    },
    body: JSON.stringify({
      model: provider.cleanupModel,
      temperature: 0,
      ...(cleanupProviderId === 'grok'
        ? {
            reasoning_effort:
              provider.cleanupModel === 'grok-4.5' ? 'low' : 'none'
          }
        : {}),
      messages: [
        {
          role: 'system',
          content: `${FAITHFUL_CLEANUP_POLICY}\n\nMode guidance:\n${mode.prompt}`
        },
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
    usage?: ApiResponseUsage
  }
  await onUsage?.(
    textUsageMeasurement(cleanupProviderId, provider.cleanupModel, 'cleanup', result.usage)
  )
  const cleaned = result.choices?.[0]?.message?.content?.trim()
  return cleaned && isFaithfulCleanup(transcript, cleaned, settings.vocabulary)
    ? cleaned
    : transcript
}

export async function transcribeAudio(
  audio: Uint8Array,
  mimeType: string,
  settings: AppSettings,
  context?: ContextSnapshot,
  signal?: AbortSignal,
  durationMs = 0,
  onUsage?: UsageSink
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
          signal,
          durationMs,
          onUsage
        )
      : settings.provider === 'grok'
        ? await transcribeGrok(
            audio,
            mimeType,
            provider,
            settings.language,
            settings.vocabulary,
            signal,
            durationMs,
            onUsage
          )
        : await transcribeOpenAICompatible(
          audio,
          mimeType,
          provider,
          settings.language,
          settings.vocabulary,
          signal,
          durationMs,
          onUsage
        )
  const spellingMemories = settings.automaticMemory
    ? extractSpellingMemories(rawText)
    : []
  const settingsWithMemory =
    spellingMemories.length > 0
      ? {
          ...settings,
          vocabulary: mergeVocabulary(settings.vocabulary, spellingMemories)
        }
      : settings
  const text = await cleanupTranscript(
    rawText,
    settingsWithMemory,
    context,
    signal,
    onUsage
  )
  const automaticMemories = settings.automaticMemory
    ? observeAutomaticTermMemories(text, automaticTermObservations)
    : []
  const learnedVocabulary = Array.from(
    new Set([...spellingMemories, ...automaticMemories])
  )
  return { text, rawText, learnedVocabulary }
}

interface MeetingNotesContext {
  userNotes?: string
  templateId?: import('../shared/types').MeetingTemplateId
  evidencePassages?: Array<{ turnId: string; text: string }>
}

export interface MeetingNotesBundle {
  notes: string
  evidence: MeetingNoteEvidence[]
}

function noteTextFromMarkdownLine(line: string): string {
  return line
    .replace(/^[-*•]\s+/, '')
    .replace(/^\d+[.)]\s+/, '')
    .replace(/^\[[ xX]\]\s*/, '')
    .trim()
}

export function extractMeetingNoteEvidence(
  markdown: string,
  validTurnIds: ReadonlySet<string>
): MeetingNotesBundle {
  const evidence: MeetingNoteEvidence[] = []
  const lines = markdown.split(/\r?\n/).map((line) => {
    const references = [...line.matchAll(/<!--\s*evidence:([^>]+?)\s*-->/gi)]
      .flatMap((match) => match[1].split(','))
      .map((id) => id.trim())
      .filter((id, index, items) => validTurnIds.has(id) && items.indexOf(id) === index)
    const cleanLine = line.replace(/<!--\s*evidence:[^>]+?-->/gi, '').trimEnd()
    const noteText = noteTextFromMarkdownLine(cleanLine.trim())
    if (references.length > 0 && noteText && !noteText.startsWith('#')) {
      evidence.push({ noteText, turnIds: references })
    }
    return cleanLine
  })
  return {
    notes: lines.join('\n').trim(),
    evidence
  }
}

export async function createMeetingNotes(
  transcript: string,
  settings: AppSettings,
  title: string,
  signal?: AbortSignal,
  onUsage?: UsageSink,
  meetingContext?: MeetingNotesContext
): Promise<string> {
  return (
    await createMeetingNotesWithEvidence(
      transcript,
      settings,
      title,
      signal,
      onUsage,
      meetingContext
    )
  ).notes
}

export async function createMeetingNotesWithEvidence(
  transcript: string,
  settings: AppSettings,
  title: string,
  signal?: AbortSignal,
  onUsage?: UsageSink,
  meetingContext?: MeetingNotesContext
): Promise<MeetingNotesBundle> {
  const fallback =
    '## Summary\n- AI summary unavailable. Configure a cleanup provider to generate meeting notes.'
  const cleanupProviderId =
    settings.cleanupProvider === 'same' ? settings.provider : settings.cleanupProvider
  const provider = settings.providers[cleanupProviderId]
  if (cleanupProviderId === 'deepgram' || (!provider.apiKey && !provider.baseUrl.includes('localhost'))) {
    return { notes: fallback, evidence: [] }
  }
  const templateId = meetingContext?.templateId || 'general'
  const templateGuidance =
    settings.meetingTemplates.find((template) => template.id === templateId)?.guidance ||
    settings.meetingTemplates.find((template) => template.id === 'general')?.guidance ||
    'Prioritize the central discussion, decisions, and follow-ups.'

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
            [
              'Create high-signal meeting notes in the same language as the transcript. Return only clean Markdown.',
              'Speaker labels in the transcript are authoritative evidence: never infer, swap, merge, or guess a person’s identity. “Others”, “Conversation”, and “Speaker A/B” must remain anonymous unless a supplied label explicitly names them.',
              'User notes are anchors written by the user; preserve their intent but verify factual claims against the transcript.',
              'Start with "## Summary" containing 3–8 concise bullets. Add "## Key points" for important context, "## Decisions" only for explicit decisions, "## To-do list" only for explicit pending work or commitments, and "## Open questions" only for unresolved questions.',
              'Format tasks as unchecked Markdown checkboxes. Include owners and dates only when explicitly stated.',
              'Never invent facts, tasks, owners, dates, decisions, quotes, or identities. Preserve names, technical terms, numbers, uncertainty, and preferred spellings. Do not append the full transcript.',
              meetingContext?.evidencePassages?.length
                ? 'Each transcript line begins with a TURN ID. End every factual bullet or task with an HTML comment exactly like <!-- evidence:TURN_ID --> or <!-- evidence:TURN_ID,TURN_ID -->. Cite only the smallest set of supplied TURN IDs that directly supports that item. Never invent or alter an ID. Do not add evidence comments to headings.'
                : ''
            ]
              .filter(Boolean)
              .join(' ')
        },
        {
          role: 'user',
          content: [
            `Meeting: ${title || 'Untitled meeting'}`,
            `Template guidance: ${templateGuidance}`,
            meetingContext?.userNotes?.trim()
              ? `User notes (anchors, not speaker identity evidence):\n${meetingContext.userNotes.trim()}`
              : '',
            settings.vocabulary.trim()
              ? `Preferred vocabulary:\n${settings.vocabulary.trim()}`
              : '',
            `Authoritative speaker-labelled transcript:\n${
              meetingContext?.evidencePassages?.length
                ? meetingContext.evidencePassages
                    .map((passage) => `[${passage.turnId}] ${passage.text}`)
                    .join('\n')
                : transcript
            }`
          ]
            .filter(Boolean)
            .join('\n\n')
        }
      ]
    }),
    signal
  })

  if (!response.ok) return { notes: fallback, evidence: [] }
  const result = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>
    usage?: ApiResponseUsage
  }
  await onUsage?.(
    textUsageMeasurement(cleanupProviderId, provider.cleanupModel, 'meeting-notes', result.usage)
  )
  const markdown = result.choices?.[0]?.message?.content?.trim() || fallback
  return extractMeetingNoteEvidence(
    markdown,
    new Set(meetingContext?.evidencePassages?.map((passage) => passage.turnId) || [])
  )
}

export async function answerMeetingQuestion(
  transcript: string,
  notes: string,
  messages: Array<{ role: 'user' | 'assistant'; content: string }>,
  question: string,
  settings: AppSettings,
  providerId: Exclude<import('../shared/types').ProviderId, 'deepgram'>,
  signal?: AbortSignal,
  onUsage?: UsageSink
): Promise<string> {
  const provider = settings.providers[providerId]
  if (!provider.apiKey && !provider.baseUrl.includes('localhost')) {
    throw new TranscriptionError(`Add an API key for ${provider.name} in Providers.`)
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
            'Answer questions using only the meeting notes and transcript supplied below. Reply in the same language as the user. Be concise but include exact names, decisions, numbers, and action items when relevant. If the answer is not in the meeting, say so clearly; never invent it.'
        },
        {
          role: 'user',
          content: `Meeting notes:\n${notes}\n\nFull transcript:\n${transcript}`
        },
        ...messages.slice(-12),
        { role: 'user', content: question }
      ]
    }),
    signal
  })
  if (!response.ok) return responseError(response)
  const result = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>
    usage?: ApiResponseUsage
  }
  const answer = result.choices?.[0]?.message?.content?.trim()
  if (!answer) throw new TranscriptionError('The provider returned an empty answer.')
  await onUsage?.(
    textUsageMeasurement(providerId, provider.cleanupModel, 'meeting-chat', result.usage)
  )
  return answer
}

export async function answerAcrossMeetings(
  meetings: MeetingRecord[],
  question: string,
  settings: AppSettings,
  providerId: Exclude<import('../shared/types').ProviderId, 'deepgram'>,
  signal?: AbortSignal,
  onUsage?: UsageSink
): Promise<string> {
  const provider = settings.providers[providerId]
  if (!provider.apiKey && !provider.baseUrl.includes('localhost')) {
    throw new TranscriptionError(`Add an API key for ${provider.name} in Providers.`)
  }
  const context = meetings.map((meeting) => [
    `# ${meeting.title}`,
    `Date: ${new Date(meeting.createdAt).toISOString()}`,
    `Notes:\n${meeting.notes.slice(0, 8_000)}`,
    `Transcript:\n${meeting.transcript.slice(0, 12_000)}`
  ].join('\n\n')).join('\n\n---\n\n')
  const response = await fetch(`${provider.baseUrl.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(provider.apiKey ? { Authorization: `Bearer ${provider.apiKey}` } : {})
    },
    body: JSON.stringify({
      model: provider.cleanupModel,
      temperature: 0.1,
      messages: [
        {
          role: 'system',
          content:
            'Answer using only the supplied meeting records. Compare meetings when useful and name the meeting title that supports each important claim. Speaker labels are authoritative; never guess an anonymous speaker’s identity. Preserve exact decisions, owners, dates, numbers, uncertainty, and contradictions. Reply in the user’s language. If the answer is not present, say so clearly.'
        },
        {
          role: 'user',
          content: `Meeting records:\n\n${context}\n\nQuestion:\n${question}`
        }
      ]
    }),
    signal
  })
  if (!response.ok) return responseError(response)
  const result = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>
    usage?: ApiResponseUsage
  }
  await onUsage?.(
    textUsageMeasurement(providerId, provider.cleanupModel, 'meeting-chat', result.usage)
  )
  const answer = result.choices?.[0]?.message?.content?.trim()
  if (!answer) throw new TranscriptionError('The provider returned an empty answer.')
  return answer
}

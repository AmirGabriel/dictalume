import type { ApiUsageEvent, ProviderId } from '../shared/types'

export type UsageMeasurement = Omit<ApiUsageEvent, 'id' | 'createdAt'>
export type UsageSink = (usage: UsageMeasurement) => void | Promise<void>

interface TokenUsage {
  prompt_tokens?: number
  completion_tokens?: number
  input_tokens?: number
  output_tokens?: number
  prompt_tokens_details?: { cached_tokens?: number }
  input_tokens_details?: { cached_tokens?: number; audio_tokens?: number; text_tokens?: number }
  cost_in_usd_ticks?: number
}

const textRates: Record<string, { input: number; cached?: number; output: number }> = {
  'gpt-4.1-mini': { input: 0.4, cached: 0.1, output: 1.6 },
  'gpt-4o-mini': { input: 0.15, cached: 0.075, output: 0.6 },
  'grok-4.3': { input: 1.25, cached: 0.2, output: 2.5 },
  'grok-4.5': { input: 2, cached: 0.3, output: 6 },
  'openai/gpt-oss-20b': { input: 0.075, cached: 0.037, output: 0.3 }
}

const audioHourlyRates: Partial<Record<ProviderId, Record<string, number>>> = {
  grok: { '*': 0.1 },
  groq: {
    'whisper-large-v3-turbo': 0.04,
    'whisper-large-v3': 0.111
  },
  deepgram: {
    'nova-3': 0.552,
    'nova-3-general': 0.552
  }
}

function normalizedModel(model: string): string {
  return model.replace(/-\d{4}-\d{2}-\d{2}$/, '')
}

export function textUsageMeasurement(
  provider: ProviderId,
  model: string,
  operation: UsageMeasurement['operation'],
  usage?: TokenUsage
): UsageMeasurement {
  const inputTokens = usage?.input_tokens ?? usage?.prompt_tokens ?? 0
  const outputTokens = usage?.output_tokens ?? usage?.completion_tokens ?? 0
  const cachedInputTokens =
    usage?.input_tokens_details?.cached_tokens ??
    usage?.prompt_tokens_details?.cached_tokens ??
    0
  const ticks = usage?.cost_in_usd_ticks
  if (typeof ticks === 'number') {
    return {
      provider,
      model,
      operation,
      costUsd: ticks / 10_000_000_000,
      exact: true,
      inputTokens,
      cachedInputTokens,
      outputTokens,
      detail: 'Exact amount returned by the provider.'
    }
  }

  const rates = textRates[normalizedModel(model)]
  if (!rates || (!inputTokens && !outputTokens)) {
    return {
      provider,
      model,
      operation,
      costUsd: null,
      exact: false,
      inputTokens,
      cachedInputTokens,
      outputTokens,
      detail: rates
        ? 'The provider did not return token usage.'
        : 'No verified price is available for this custom model.'
    }
  }
  const uncachedInput = Math.max(0, inputTokens - cachedInputTokens)
  const costUsd =
    (uncachedInput * rates.input +
      cachedInputTokens * (rates.cached ?? rates.input) +
      outputTokens * rates.output) /
    1_000_000
  return {
    provider,
    model,
    operation,
    costUsd,
    exact: false,
    inputTokens,
    cachedInputTokens,
    outputTokens,
    detail: 'Calculated from provider-reported tokens and the verified model rate.'
  }
}

export function audioUsageMeasurement(
  provider: ProviderId,
  model: string,
  audioSeconds: number,
  usage?: TokenUsage,
  additionalHourlyRate = 0,
  hourlyRateOverride?: number
): UsageMeasurement {
  const ticks = usage?.cost_in_usd_ticks
  if (typeof ticks === 'number') {
    return {
      provider,
      model,
      operation: 'transcription',
      costUsd: ticks / 10_000_000_000,
      exact: true,
      audioSeconds,
      detail: 'Exact amount returned by the provider.'
    }
  }

  if (provider === 'openai') {
    const inputTokens = usage?.input_tokens ?? usage?.prompt_tokens ?? 0
    const outputTokens = usage?.output_tokens ?? usage?.completion_tokens ?? 0
    const audioTokens = usage?.input_tokens_details?.audio_tokens ?? inputTokens
    if (audioTokens || outputTokens) {
      return {
        provider,
        model,
        operation: 'transcription',
        costUsd: (audioTokens * 1.25 + outputTokens * 5) / 1_000_000,
        exact: false,
        inputTokens: audioTokens,
        outputTokens,
        audioSeconds,
        detail: 'Calculated from OpenAI-reported audio/output tokens.'
      }
    }
  }

  const rate =
    hourlyRateOverride ??
    audioHourlyRates[provider]?.[normalizedModel(model)] ??
    audioHourlyRates[provider]?.['*']
  if (rate !== undefined && audioSeconds > 0) {
    const billedSeconds = provider === 'groq' ? Math.max(10, audioSeconds) : audioSeconds
    return {
      provider,
      model,
      operation: 'transcription',
      costUsd: (billedSeconds / 3600) * (rate + additionalHourlyRate),
      exact: false,
      audioSeconds,
      detail:
        provider === 'groq' && audioSeconds < 10
          ? 'Calculated with Groq’s 10-second minimum billable length.'
          : additionalHourlyRate > 0
            ? 'Calculated from duration, model rate, and enabled billable add-ons.'
            : 'Calculated from recorded duration and the verified per-hour rate.'
    }
  }
  return {
    provider,
    model,
    operation: 'transcription',
    costUsd: null,
    exact: false,
    audioSeconds,
    detail: 'No verified price or billable usage was returned for this model.'
  }
}

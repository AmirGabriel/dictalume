import { describe, expect, it } from 'vitest'
import { audioUsageMeasurement, textUsageMeasurement } from './apiUsage'

describe('API usage accounting', () => {
  it('uses exact xAI cost ticks when the provider returns them', () => {
    const usage = textUsageMeasurement('grok', 'grok-4.5', 'meeting-chat', {
      input_tokens: 199,
      output_tokens: 1,
      cost_in_usd_ticks: 1_585_000
    })
    expect(usage.exact).toBe(true)
    expect(usage.costUsd).toBe(0.0001585)
  })

  it('prices cached and uncached cleanup tokens independently', () => {
    const usage = textUsageMeasurement('openai', 'gpt-4.1-mini', 'cleanup', {
      prompt_tokens: 1_000,
      completion_tokens: 100,
      prompt_tokens_details: { cached_tokens: 400 }
    })
    expect(usage.exact).toBe(false)
    expect(usage.costUsd).toBeCloseTo(0.00044, 10)
  })

  it('prices the low-latency Grok cleanup default', () => {
    const usage = textUsageMeasurement('grok', 'grok-4.3', 'cleanup', {
      input_tokens: 1_000,
      output_tokens: 100,
      input_tokens_details: { cached_tokens: 400 }
    })
    expect(usage.costUsd).toBeCloseTo(0.00108, 10)
  })

  it('prices Groq Turbo transcription from actual duration', () => {
    const usage = audioUsageMeasurement('groq', 'whisper-large-v3-turbo', 90)
    expect(usage.costUsd).toBeCloseTo(0.001, 10)
    expect(usage.audioSeconds).toBe(90)
  })

  it('applies Groq minimum billing to short clips', () => {
    const usage = audioUsageMeasurement('groq', 'whisper-large-v3-turbo', 2)
    expect(usage.costUsd).toBeCloseTo(0.0001111111, 10)
    expect(usage.detail).toContain('10-second minimum')
  })

  it('keeps unknown custom models visible as unpriced', () => {
    const usage = textUsageMeasurement('custom', 'private-model', 'meeting-chat')
    expect(usage.costUsd).toBeNull()
    expect(usage.detail).toContain('No verified price')
  })
})

import type { AppSettings } from '../shared/types'

const faithfulCleanupPrompt =
  'Clean the transcript without rewriting its ideas: add punctuation, correct grammar, remove verbal filler and near-verbatim repetition, and carry out only explicit self-editing commands such as “delete the last sentence.” Preserve every fact, example, request, constraint, caveat, name, number, technical term, uncertainty, and the speaker’s original intent. Never summarize, reinterpret, infer, add information, make the text more persuasive, or change its meaning.'

const legacyBuiltInPrompts: Record<string, string> = {
  dictation:
    'Rewrite this voice transcript as polished prose in the language being spoken. Preserve meaning and terminology, apply preferred spellings, add natural punctuation, and remove filler words and false starts. If the speaker explains how a word is spelled, use that spelling but omit the spelling instruction. Return only the rewritten text.',
  code:
    'Turn this spoken transcript into a precise instruction for a coding agent in the language being spoken. Preserve filenames, symbols, technical terms, preferred spellings, and stated constraints. If the speaker explains how a word is spelled, use that spelling but omit the spelling instruction. Use short paragraphs or bullets only when useful. Return only the instruction.',
  message:
    'Rewrite this transcript as a concise, naturally punctuated message in the language and tone of the speaker. Apply preferred spellings. If the speaker explains how a word is spelled, use that spelling but omit the spelling instruction. Remove filler and repetition without making it formal. Return only the message.'
}

export function migrateBuiltInModePrompt(id: string, prompt: string): string {
  return legacyBuiltInPrompts[id] === prompt ? faithfulCleanupPrompt : prompt
}

export function migrateGrokCleanupModel(model: string): string {
  // grok-4.5 was Dictalume's previous default. Transcript cleanup does not need
  // its mandatory reasoning, so existing default installs move to xAI's fast
  // non-reasoning path. Any other/custom model slug is preserved verbatim.
  return model === 'grok-4.5' ? 'grok-4.3' : model
}

export const defaultSettings: AppSettings = {
  provider: 'openai',
  shortcut: 'CommandOrControl+Shift+Space',
  changeModeShortcut: 'CommandOrControl+Option+Space',
  languageShortcuts: {
    en: '',
    pt: ''
  },
  language: 'auto',
  mode: 'dictation',
  autoPaste: true,
  copyToClipboard: true,
  launchAtLogin: false,
  soundEffects: true,
  cleanupProvider: 'same',
  automaticMemory: true,
  vocabulary: '',
  meetingTemplates: [
    {
      id: 'general',
      name: 'General meeting',
      guidance: 'Prioritize the central discussion, decisions, and follow-ups.',
      builtIn: true
    },
    {
      id: 'one-on-one',
      name: '1:1',
      guidance: 'Prioritize updates, feedback, goals, support needed, and commitments.',
      builtIn: true
    },
    {
      id: 'standup',
      name: 'Standup',
      guidance: 'Prioritize progress, current work, blockers, and next steps.',
      builtIn: true
    },
    {
      id: 'sales',
      name: 'Sales',
      guidance: 'Prioritize customer needs, objections, buying signals, commitments, and next steps.',
      builtIn: true
    },
    {
      id: 'user-research',
      name: 'User research',
      guidance: 'Prioritize observed needs, pain points, workflows, quotes, and insights.',
      builtIn: true
    },
    {
      id: 'interview',
      name: 'Interview',
      guidance: 'Prioritize questions, evidence from answers, strengths, concerns, and follow-ups.',
      builtIn: true
    }
  ],
  meetingRecipes: [
    {
      id: 'follow-up',
      name: 'Draft follow-up',
      prompt:
        'Draft a concise follow-up email from this meeting. Include only confirmed decisions, commitments, owners, and next steps.',
      builtIn: true
    },
    {
      id: 'decisions',
      name: 'Decisions',
      prompt:
        'List every explicit decision from this meeting. If there were none, say so.',
      builtIn: true
    },
    {
      id: 'action-items',
      name: 'Action items',
      prompt:
        'List every explicit action item with owner and due date only when stated.',
      builtIn: true
    }
  ],
  meetingSpaces: [],
  meetingConsentMessageEnabled: false,
  meetingConsentMessage:
    'This meeting is being transcribed by Dictalume so I can create private notes. Please let me know if you would prefer that I stop.',
  meetingTranscriptionProvider: 'same',
  meetingTranscriptRetentionDays: 0,
  providers: {
    openai: {
      id: 'openai',
      name: 'OpenAI',
      baseUrl: 'https://api.openai.com/v1',
      model: 'gpt-4o-mini-transcribe',
      cleanupModel: 'gpt-4.1-mini',
      apiKey: ''
    },
    grok: {
      id: 'grok',
      name: 'Grok · xAI',
      baseUrl: 'https://api.x.ai/v1',
      model: 'grok-4.5',
      cleanupModel: 'grok-4.3',
      apiKey: ''
    },
    groq: {
      id: 'groq',
      name: 'Groq Cloud',
      baseUrl: 'https://api.groq.com/openai/v1',
      model: 'whisper-large-v3-turbo',
      cleanupModel: 'openai/gpt-oss-20b',
      apiKey: ''
    },
    deepgram: {
      id: 'deepgram',
      name: 'Deepgram',
      baseUrl: 'https://api.deepgram.com',
      model: 'nova-3',
      cleanupModel: '',
      apiKey: ''
    },
    custom: {
      id: 'custom',
      name: 'Custom endpoint',
      baseUrl: 'http://localhost:8000/v1',
      model: 'whisper-1',
      cleanupModel: 'gpt-4.1-mini',
      apiKey: ''
    }
  },
  modes: {
    dictation: {
      id: 'dictation',
      name: 'Dictation',
      description: 'Clean prose with punctuation',
      cleanup: true,
      context: { application: true, clipboard: false, selectedText: false },
      activateFor: [],
      prompt: faithfulCleanupPrompt
    },
    code: {
      id: 'code',
      name: 'Vibe code',
      description: 'Clear instructions for coding agents',
      cleanup: true,
      context: { application: true, clipboard: true, selectedText: true },
      activateFor: ['Cursor', 'Visual Studio Code', 'Xcode'],
      prompt: faithfulCleanupPrompt
    },
    message: {
      id: 'message',
      name: 'Message',
      description: 'Natural chat and email',
      cleanup: true,
      context: { application: true, clipboard: false, selectedText: false },
      activateFor: ['Messages', 'Slack', 'WhatsApp'],
      prompt: faithfulCleanupPrompt
    },
    raw: {
      id: 'raw',
      name: 'Raw transcript',
      description: 'No AI cleanup',
      cleanup: false,
      context: { application: false, clipboard: false, selectedText: false },
      activateFor: [],
      prompt: ''
    }
  }
}

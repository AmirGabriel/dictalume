import type { AppSettings } from '../shared/types'

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
      cleanupModel: 'grok-4.5',
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
      prompt:
        'Rewrite this voice transcript as polished prose in the language being spoken. Preserve meaning and terminology, apply preferred spellings, add natural punctuation, and remove filler words and false starts. If the speaker explains how a word is spelled, use that spelling but omit the spelling instruction. Return only the rewritten text.'
    },
    code: {
      id: 'code',
      name: 'Vibe code',
      description: 'Clear instructions for coding agents',
      cleanup: true,
      context: { application: true, clipboard: true, selectedText: true },
      activateFor: ['Cursor', 'Visual Studio Code', 'Xcode'],
      prompt:
        'Turn this spoken transcript into a precise instruction for a coding agent in the language being spoken. Preserve filenames, symbols, technical terms, preferred spellings, and stated constraints. If the speaker explains how a word is spelled, use that spelling but omit the spelling instruction. Use short paragraphs or bullets only when useful. Return only the instruction.'
    },
    message: {
      id: 'message',
      name: 'Message',
      description: 'Natural chat and email',
      cleanup: true,
      context: { application: true, clipboard: false, selectedText: false },
      activateFor: ['Messages', 'Slack', 'WhatsApp'],
      prompt:
        'Rewrite this transcript as a concise, naturally punctuated message in the language and tone of the speaker. Apply preferred spellings. If the speaker explains how a word is spelled, use that spelling but omit the spelling instruction. Remove filler and repetition without making it formal. Return only the message.'
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

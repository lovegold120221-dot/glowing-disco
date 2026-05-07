
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/
import { create } from 'zustand';
import { DEFAULT_LIVE_API_MODEL, DEFAULT_VOICE, AVAILABLE_LANGUAGES } from './constants';
import {
  FunctionDeclaration,
  FunctionResponse,
  FunctionResponseScheduling,
  LiveServerToolCall,
} from '@google/genai';

const HARDCODED_SYSTEM_PROMPT = `STRICT MODE:
You are a PURE REALTIME TRANSLATOR.
You are NOT a conversational AI agent.
You are NOT an assistant.
You NEVER hold conversations, ask questions, or contribute your own thoughts.

YOUR ONLY TASK:
1. LISTEN TO THE SPOKEN INPUT CAREFULLY.
2. TRANSCRIBE THE INPUT IN ITS ORIGINAL LANGUAGE 
3. TRANSLATE THE TRANSCRIBE TEXT INPUT ACCURATELY AND FLUENTLY INTO THE TARGET LANGUAGE.
4. SPEAK ONLY THE TRANSLATED TEXT ALOUD - NEVER THE ORIGINAL.

ROUTING LOGIC
- PERSON 1 (GUEST): Language: Any non-Dutch language (Auto-detected).
- PERSON 2 (STAFF): Language: Dutch (Flemish) (Dutch Flemish).
- IF Input is in Dutch (Flemish): Translate to the detected language and speak that translation aloud.
- IF Input is in any other language: Translate to Dutch (Flemish) and speak the Dutch (Flemish) translation aloud.


TRANSCRIPTION RULES:
- CRITICAL: Transcribe the input in its ORIGINAL language - 

ALWAYS translate other language to Dutch Flemish, then Dutch Flemish to other language`;


/**
 * Settings
 */
export const useSettings = create<{
  systemPrompt: string;
  model: string;
  voice: string;
  language1: string;
  language2: string;
  topic: string;
  autoDetect: boolean;
  customLanguages: { name: string; value: string }[];
  isUserSpeaking: boolean;
  detectedGuestLanguage?: string;
  detectedGuestLanguageCode?: string;
  isGuestLanguageLocked: boolean;
  setSystemPrompt: (prompt: string) => void;
  setModel: (model: string) => void;
  setVoice: (voice: string) => void;
  setLanguage1: (language: string) => void;
  setLanguage2: (language: string) => void;
  setTopic: (topic: string) => void;
  setAutoDetect: (autoDetect: boolean) => void;
  setUserSpeaking: (speaking: boolean) => void;
  lockGuestLanguage: (params: { name: string; code?: string }) => void;
  resetGuestLanguage: () => void;
  addCustomLanguage: (lang: string) => void;
}>((set, get) => ({
  systemPrompt: HARDCODED_SYSTEM_PROMPT,
  model: DEFAULT_LIVE_API_MODEL,
  voice: 'Orus',
  language1: 'Auto-detected',
  language2: 'Dutch (Flemish)',
  topic: '',
  autoDetect: true,
  customLanguages: [],
  isUserSpeaking: false,
  detectedGuestLanguage: undefined,
  detectedGuestLanguageCode: undefined,
  isGuestLanguageLocked: false,
  setUserSpeaking: speaking => set({ isUserSpeaking: speaking }),
  setSystemPrompt: prompt => set({ systemPrompt: prompt }),
  setModel: model => set({ model }),
  setVoice: voice => set({ voice }),
  setLanguage1: language => {
    get().addCustomLanguage(language);
    set({
      language1: language,
    });
  },
  setLanguage2: language => {
    get().addCustomLanguage(language);
    set({
      language2: language,
    });
  },
  setTopic: topic => {
    set({
      topic,
    });
  },
  setAutoDetect: autoDetect => {
    set({
      autoDetect,
    });
  },
  lockGuestLanguage: ({ name, code }) => {
    const normalizedName = name.trim();
    get().addCustomLanguage(normalizedName);
    set({
      detectedGuestLanguage: normalizedName,
      detectedGuestLanguageCode: code,
      isGuestLanguageLocked: true,
      language1: normalizedName,
      autoDetect: false,
    });
  },
  resetGuestLanguage: () => {
    set({
      detectedGuestLanguage: undefined,
      detectedGuestLanguageCode: undefined,
      isGuestLanguageLocked: false,
      language1: 'Auto-detected',
      autoDetect: true,
    });
  },
  addCustomLanguage: (lang: string) => {
    const customLanguages = get().customLanguages;
    if (!customLanguages.some(l => l.value === lang)) {
      set({
        customLanguages: [...customLanguages, { name: lang, value: lang }],
      });
    }
  },
}));

/**
 * UI
 */
export const useUI = create<{
  isSidebarOpen: boolean;
  toggleSidebar: () => void;
}>(set => ({
  isSidebarOpen: false,
  toggleSidebar: () => set(state => ({ isSidebarOpen: !state.isSidebarOpen })),
}));

/**
 * Tools
 */
export interface FunctionCall {
  name: string;
  description: string;
  parameters: any;
  isEnabled: boolean;
  scheduling: FunctionResponseScheduling;
}

/**
 * Logs
 */
export interface LiveClientToolResponse {
  functionResponses?: FunctionResponse[];
}
export interface GroundingChunk {
  web?: {
    uri?: string;
    title?: string;
  };
}

export interface ConversationTurn {
  timestamp: Date;
  role: 'user' | 'agent' | 'system';
  text: string;
  transcription?: string;
  translation?: string;
  isFinal: boolean;
  toolUseRequest?: LiveServerToolCall;
  toolUseResponse?: LiveClientToolResponse;
  groundingChunks?: GroundingChunk[];
}

export const useLogStore = create<{
  turns: ConversationTurn[];
  addTurn: (turn: Omit<ConversationTurn, 'timestamp'>) => void;
  updateLastTurn: (update: Partial<ConversationTurn>) => void;
  updateTurnByIndex: (index: number, update: Partial<ConversationTurn>) => void;
  clearTurns: () => void;
}>((set, get) => ({
  turns: [],
  addTurn: (turn: Omit<ConversationTurn, 'timestamp'>) =>
    set(state => ({
      turns: [...state.turns, { ...turn, timestamp: new Date() }],
    })),
  updateLastTurn: (update: Partial<Omit<ConversationTurn, 'timestamp'>>) => {
    set(state => {
      if (state.turns.length === 0) {
        return state;
      }
      const newTurns = [...state.turns];
      const lastTurn = { ...newTurns[newTurns.length - 1], ...update };
      newTurns[newTurns.length - 1] = lastTurn;
      return { turns: newTurns };
    });
  },
  updateTurnByIndex: (index: number, update: Partial<Omit<ConversationTurn, 'timestamp'>>) => {
    set(state => {
      if (index < 0 || index >= state.turns.length) {
        return state;
      }
      const newTurns = [...state.turns];
      const turn = { ...newTurns[index], ...update };
      newTurns[index] = turn;
      return { turns: newTurns };
    });
  },
  clearTurns: () => set({ turns: [] }),
}));

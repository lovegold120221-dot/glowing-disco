/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/
import React, { useEffect, useRef } from 'react';
import WelcomeScreen from '../welcome-screen/WelcomeScreen';
// FIX: Import LiveServerContent to correctly type the content handler.
import { Modality, LiveServerContent, Type, LiveServerToolCall } from '@google/genai';

import { useLiveAPIContext } from '../../../contexts/LiveAPIContext';
import {
  useSettings,
  useLogStore,
  ConversationTurn,
} from '../../../lib/state';
import { useHistoryStore } from '../../../lib/history';
import { useAuth, updateUserConversations } from '../../../lib/auth';
import { detectLanguageFromText, isDutchLanguage } from '../../../lib/languageDetection';

export default function StreamingConsole() {
  const { client, setConfig, connected } = useLiveAPIContext();
  const { systemPrompt, voice, language1, language2, isUserSpeaking } = useSettings();
  const { addHistoryItem } = useHistoryStore();
  const { user } = useAuth();

  const turns = useLogStore(state => state.turns);
  const scrollRef = useRef<HTMLDivElement>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const isTurnComplete = useRef(true);
  const userFinishedSpeaking = useRef(true);
  const pendingAgentText = useRef('');
  const pendingAgentGrounding = useRef<any[]>([]);

  const appendWithSpace = (base: string, addition: string) => {
    if (!addition) return base;
    if (!base) return addition;
    const needsSpace = !base.endsWith(' ') && !addition.startsWith(' ');
    return `${base}${needsSpace ? ' ' : ''}${addition}`;
  };

  // Audio intro autoplay removed

  // Set the configuration for the Live API
  useEffect(() => {
    // Using `any` for config to accommodate `speechConfig`, which is not in the
    // current TS definitions but is used in the working reference example.
    const config: any = {
      responseModalities: [Modality.AUDIO],
      inputAudioTranscription: {
        model: 'latest',
      },
      outputAudioTranscription: {
        model: 'latest',
      },
      speechConfig: {
        voiceConfig: {
          prebuiltVoiceConfig: {
            voiceName: voice,
          },
        },
      },
      generationConfig: {
        temperature: 0.1,
        maxOutputTokens: 2048,
        candidateCount: 1,
      },
      systemInstruction: {
        parts: [
          {
            text: systemPrompt,
          },
        ],
      },
      tools: [
        {
          functionDeclarations: [
            {
              name: 'setGuestLanguage',
              description: 'Set the guest language. Call this tool when the user tells you what language they speak or want to translate to.',
              parameters: {
                type: Type.OBJECT,
                properties: {
                  language: {
                    type: Type.STRING,
                    description: 'The name of the language the guest speaks.',
                  },
                },
                required: ['language'],
              },
            }
          ]
        }
      ],
    };

    setConfig(config);
  }, [setConfig, systemPrompt, voice]);

  useEffect(() => {
    const { addTurn, updateLastTurn } = useLogStore.getState();

    const handleInputTranscription = (text: string, isFinal: boolean) => {
      const turns = useLogStore.getState().turns;
      const last = turns[turns.length - 1];
      if (last && last.role === 'user' && !last.isFinal) {
        isTurnComplete.current = false;
        userFinishedSpeaking.current = false;
        const updatedTranscription = (last.transcription || '') + text;
        updateLastTurn({
          transcription: updatedTranscription,
          text: updatedTranscription,
          isFinal,
        });
        if (isFinal) {
          attemptLanguageLock(updatedTranscription);
        }
      } else {
        isTurnComplete.current = false;
        userFinishedSpeaking.current = false;
        addTurn({ role: 'user', transcription: text, text, isFinal });
        if (isFinal) {
          attemptLanguageLock(text);
        }
      }
    };

    const handleOutputTranscription = (text: string, isFinal: boolean) => {
      const turns = useLogStore.getState().turns;
      const last = turns[turns.length - 1];
      if (last && last.role === 'agent' && !last.isFinal) {
        updateLastTurn({
          text: last.text + text,
          isFinal,
        });
      } else {
        addTurn({ role: 'agent', text, isFinal });
      }
    };

    const attemptLanguageLock = (rawText: string) => {
      const trimmed = rawText?.trim();
      if (!trimmed) return;
      const { isGuestLanguageLocked, lockGuestLanguage } = useSettings.getState();
      if (isGuestLanguageLocked) return;
      const detection = detectLanguageFromText(trimmed);
      if (!detection) return;
      if (isDutchLanguage(detection.iso2, detection.name)) {
        return;
      }
      lockGuestLanguage({ name: detection.name, code: detection.iso2 });
    };

    const handleContent = (serverContent: LiveServerContent) => {
      const text =
        serverContent.modelTurn?.parts
          ?.map((p: any) => p.text)
          .filter(Boolean)
          .join(' ') ?? '';
      const incomingGrounding = serverContent.groundingMetadata?.groundingChunks;

      let processedText = text;
      let groundingChunks = incomingGrounding;

      if (!processedText && !groundingChunks && !pendingAgentText.current && !pendingAgentGrounding.current.length) return;

      // Only process translation if user has finished speaking (3 seconds of silence)
      if (isUserSpeaking) {
        if (processedText) {
          pendingAgentText.current = appendWithSpace(pendingAgentText.current, processedText);
        }
        if (groundingChunks?.length) {
          pendingAgentGrounding.current.push(...groundingChunks);
        }
        return; // Wait for user to finish speaking
      }

      const turns = useLogStore.getState().turns;
      const last = turns[turns.length - 1];

      // Do not translate while there's an unfinished user turn
      const hasUnfinishedUserTurn = turns.some(
        turn => turn.role === 'user' && !turn.isFinal
      );
      if (hasUnfinishedUserTurn) {
        if (processedText) {
          pendingAgentText.current += processedText;
        }
        if (groundingChunks?.length) {
          pendingAgentGrounding.current.push(...groundingChunks);
        }
        return;
      }

      // Only process agent content if there's user input to translate
      const hasUserInput = turns.some(turn => turn.role === 'user' && turn.transcription);
      if (!hasUserInput) {
        return; // Don't translate without user input
      }

      if (pendingAgentText.current) {
        processedText = appendWithSpace(pendingAgentText.current, processedText);
        pendingAgentText.current = '';
      }

      if (pendingAgentGrounding.current.length) {
        groundingChunks = [...pendingAgentGrounding.current, ...(groundingChunks || [])];
        pendingAgentGrounding.current = [];
      }

      if (last?.role === 'agent' && !last.isFinal) {
        const updatedTurn: Partial<ConversationTurn> = {};

        if (processedText) {
          updatedTurn.translation = appendWithSpace(last.translation || '', processedText);
        }

        if (groundingChunks) {
          updatedTurn.groundingChunks = [
            ...(last.groundingChunks || []),
            ...groundingChunks,
          ];
        }
        updateLastTurn(updatedTurn);
      } else {
        const newTurn: Omit<ConversationTurn, 'timestamp'> = {
          role: 'agent',
          text: '', // Let outputTranscription handle the main text if no text parts
          translation: processedText || undefined,
          isFinal: false,
          groundingChunks
        };

        addTurn(newTurn);
      }
    };

    const handleToolCall = (toolCall: LiveServerToolCall) => {
      if (toolCall.functionCalls) {
        const functionResponses = toolCall.functionCalls.map((fc) => {
          if (fc.name === 'setGuestLanguage') {
            const args = fc.args as any;
            if (args.language) {
              useSettings.getState().setLanguage2(args.language);
              useSettings.getState().setAutoDetect(false);
            }
            return {
              id: fc.id,
              name: fc.name,
              response: { result: `Guest language successfully set to ${args.language}. From now on, the GUEST LANGUAGE is ${args.language}. You must translate between the STAFF LANGUAGE and ${args.language} vice versa.` }
            };
          }
          return {
            id: fc.id,
            name: fc.name,
            response: { error: 'Unknown function' }
          };
        });

        client.sendToolResponse({ functionResponses });
      }
    };

    const handleTurnComplete = () => {
      const { turns, updateLastTurn } = useLogStore.getState();
      const last = turns[turns.length - 1];

      if (last && !last.isFinal) {
        updateLastTurn({ isFinal: true });
        const updatedTurns = useLogStore.getState().turns;

        if (user) {
          updateUserConversations(user.id, updatedTurns);
        }

        const finalAgentTurn = updatedTurns[updatedTurns.length - 1];

        if (finalAgentTurn?.role === 'agent') {
          const agentTurnIndex = updatedTurns.length - 1;
          let correspondingUserTurn = null;
          for (let i = agentTurnIndex - 1; i >= 0; i--) {
            if (updatedTurns[i].role === 'user') {
              correspondingUserTurn = updatedTurns[i];
              break;
            }
          }

          // Use the parsed translation for history
          const translatedText = finalAgentTurn.translation || finalAgentTurn.text;
          const sourceText = finalAgentTurn.transcription || correspondingUserTurn?.text || '';

          if (translatedText && sourceText) {
            addHistoryItem({
              sourceText: sourceText.trim(),
              translatedText: translatedText.trim(),
              lang1: language1,
              lang2: language2
            });
          }
        }

        // Mark turn as complete to allow new input
        isTurnComplete.current = true;
      }
    };

    client.on('inputTranscription', handleInputTranscription);
    client.on('outputTranscription', handleOutputTranscription);
    client.on('content', handleContent);
    client.on('toolcall', handleToolCall);
    client.on('turncomplete', handleTurnComplete);

    return () => {
      client.off('inputTranscription', handleInputTranscription);
      client.off('outputTranscription', handleOutputTranscription);
      client.off('content', handleContent);
      client.off('toolcall', handleToolCall);
      client.off('turncomplete', handleTurnComplete);
    };
  }, [client, addHistoryItem, user, language1, language2]);

  return (
    <div className="transcription-container">
      <WelcomeScreen />
    </div>
  );
}


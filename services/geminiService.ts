import { GoogleGenAI, Modality } from "@google/genai";
import { Emotion, VoiceName } from "../types";
import { EMOTION_TAGS, VOICE_ENGINE_SYSTEM_PROMPT } from "../constants";

// Helper to decode base64 string to Uint8Array
const decodeBase64 = (base64: string): Uint8Array => {
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
};

// Helper to convert raw PCM data to AudioBuffer
// Gemini 2.5 TTS returns 24kHz mono PCM 16-bit
const pcmToAudioBuffer = (
  data: Uint8Array, 
  audioContext: AudioContext,
  sampleRate: number = 24000,
  numChannels: number = 1
): AudioBuffer => {
  const dataInt16 = new Int16Array(data.buffer);
  const frameCount = dataInt16.length / numChannels;
  const buffer = audioContext.createBuffer(numChannels, frameCount, sampleRate);

  for (let channel = 0; channel < numChannels; channel++) {
    const channelData = buffer.getChannelData(channel);
    for (let i = 0; i < frameCount; i++) {
      // Convert 16-bit integer (-32768 to 32767) to float (-1.0 to 1.0)
      channelData[i] = dataInt16[i * numChannels + channel] / 32768.0;
    }
  }
  return buffer;
};

// SSML Stripper for the TTS engine
export const stripSSML = (text: string): string => {
  return text.replace(/<[^>]*>/g, '');
};

export const optimizeTextWithThinking = async (
  text: string, 
  emotion: Emotion,
  apiKey: string
): Promise<string> => {
  if (!apiKey) throw new Error("API Key is required");
  
  const ai = new GoogleGenAI({ apiKey });
  
  // Use Gemini 3 Pro with Thinking for deep phonetic and prosody analysis
  const response = await ai.models.generateContent({
    model: "gemini-3-pro-preview",
    contents: `
      User Input: "${text}"
      Target Emotion: ${emotion}
      
      Task: Rewrite the user input to perfectly match the target emotion and phonetic guidelines.
      
      Advanced Instructions:
      1. Return the Bengali text ENHANCED with pseudo-SSML tags to indicate prosody.
      2. Use <break time="medium"/> for commas, <break time="long"/> for sentence ends.
      3. Use <emphasis level="strong">word</emphasis> for words requiring heavy stress.
      4. Fix phonetic spellings for "Jukto-borno" to ensure clarity (e.g., ensure 'o' vs 'a' sounds are written phonetically if ambiguous).
      
      Return ONLY the Bengali text with these tags.
    `,
    config: {
      systemInstruction: VOICE_ENGINE_SYSTEM_PROMPT,
      thinkingConfig: {
        thinkingBudget: 32768, 
      },
    }
  });

  return response.text?.trim() || text;
};

export const quickPolishText = async (text: string, apiKey: string): Promise<string> => {
    if (!apiKey) throw new Error("API Key is required");
    const ai = new GoogleGenAI({ apiKey });

    const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: `Fix grammar and spelling for this Bengali text, keeping the meaning identical. Do NOT add SSML tags: "${text}"`,
    });
    return response.text?.trim() || text;
}

export const synthesizeSpeech = async (
  text: string,
  emotion: Emotion,
  voice: VoiceName,
  audioContext: AudioContext,
  apiKey: string
): Promise<AudioBuffer> => {
  if (!apiKey) throw new Error("API Key is required");

  const ai = new GoogleGenAI({ apiKey });
  
  const processingInstruction = EMOTION_TAGS[emotion];
  let cleanText = stripSSML(text);
  const finalPrompt = `${processingInstruction}${cleanText}`;

  const responseStream = await ai.models.generateContentStream({
    model: "gemini-2.5-flash-preview-tts",
    contents: [{ parts: [{ text: finalPrompt }] }],
    config: {
      responseModalities: [Modality.AUDIO],
      speechConfig: {
        voiceConfig: {
          prebuiltVoiceConfig: {
            voiceName: voice,
          },
        },
      },
    },
  });

  const chunks: Uint8Array[] = [];
  
  for await (const chunk of responseStream) {
      if (chunk.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data) {
          const base64Part = chunk.candidates[0].content.parts[0].inlineData.data;
          chunks.push(decodeBase64(base64Part));
      }
  }

  if (chunks.length === 0) {
    throw new Error("No audio data generated");
  }

  // Concatenate chunks
  const totalLength = chunks.reduce((acc, curr) => acc + curr.length, 0);
  const combinedBytes = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
      combinedBytes.set(chunk, offset);
      offset += chunk.length;
  }

  return pcmToAudioBuffer(combinedBytes, audioContext);
};
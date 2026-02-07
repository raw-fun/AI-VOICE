export enum Emotion {
  NEUTRAL = 'Neutral',
  HAPPY = 'Happy',
  SAD = 'Sad',
  SERIOUS = 'Serious',
  STORY = 'Storytelling',
  NEWS = 'News Anchor'
}

export enum VoiceName {
  Puck = 'Puck',
  Charon = 'Charon',
  Kore = 'Kore',
  Fenrir = 'Fenrir',
  Zephyr = 'Zephyr'
}

export interface ProcessingState {
  isThinking: boolean;
  isSynthesizing: boolean;
  progress: number; // 0-100
  statusMessage: string;
}

export interface AudioResult {
  audioBuffer: AudioBuffer | null;
  duration: number;
}

export interface HistoryItem {
  id: string;
  text: string;
  originalText: string;
  emotion: Emotion;
  voice: VoiceName;
  timestamp: number;
  audioBlob: Blob; // Stored in IndexedDB
}
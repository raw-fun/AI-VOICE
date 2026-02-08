import React, { useState, useEffect, useRef } from 'react';
import { Emotion, VoiceName, ProcessingState, HistoryItem } from './types';
import { optimizeTextWithThinking, synthesizeSpeech, quickPolishText } from './services/geminiService';
import { saveHistoryItem, getHistoryItems, deleteHistoryItem } from './services/historyService';
import AudioVisualizer from './components/AudioVisualizer';
import ThinkingIndicator from './components/ThinkingIndicator';
import HistorySidebar from './components/HistorySidebar';
import { SAMPLE_TEXTS } from './constants';
import { 
  PlayIcon, 
  PauseIcon, 
  SparklesIcon, 
  MicrophoneIcon, 
  SpeakerWaveIcon, 
  BoltIcon,
  CpuChipIcon,
  AdjustmentsHorizontalIcon,
  SignalIcon,
  ArrowDownTrayIcon,
  ClockIcon,
  MusicalNoteIcon,
  SwatchIcon,
  KeyIcon
} from '@heroicons/react/24/solid';

const VOICE_META = {
  [VoiceName.Puck]: { 
    label: "Puck",
    desc: "Playful & Energetic", 
    gradient: "from-cyan-400 to-blue-500", 
    bg: "bg-cyan-900/20", 
    border: "border-cyan-500/30",
    iconColor: "text-cyan-400"
  },
  [VoiceName.Charon]: { 
    label: "Charon",
    desc: "Deep & Authoritative", 
    gradient: "from-indigo-400 to-purple-500", 
    bg: "bg-indigo-900/20", 
    border: "border-indigo-500/30",
    iconColor: "text-indigo-400"
  },
  [VoiceName.Kore]: { 
    label: "Kore",
    desc: "Calm & Soothing", 
    gradient: "from-teal-400 to-emerald-500", 
    bg: "bg-teal-900/20", 
    border: "border-teal-500/30",
    iconColor: "text-teal-400"
  },
  [VoiceName.Fenrir]: { 
    label: "Fenrir",
    desc: "Intense & Dynamic", 
    gradient: "from-red-400 to-orange-500", 
    bg: "bg-red-900/20", 
    border: "border-red-500/30",
    iconColor: "text-red-400"
  },
  [VoiceName.Zephyr]: { 
    label: "Zephyr",
    desc: "Balanced & Neutral", 
    gradient: "from-blue-400 to-indigo-500", 
    bg: "bg-blue-900/20", 
    border: "border-blue-500/30",
    iconColor: "text-blue-400"
  },
};

// WAV Encoding Helper
const writeString = (view: DataView, offset: number, string: string) => {
  for (let i = 0; i < string.length; i++) {
    view.setUint8(offset + i, string.charCodeAt(i));
  }
};

const audioBufferToWav = (buffer: AudioBuffer) => {
  const numChannels = buffer.numberOfChannels;
  const sampleRate = buffer.sampleRate;
  const format = 1; // PCM
  const bitDepth = 16;
  
  const length = buffer.length * numChannels * 2; 
  const bufferArray = new ArrayBuffer(44 + length);
  const view = new DataView(bufferArray);
  
  writeString(view, 0, 'RIFF');
  view.setUint32(4, 36 + length, true);
  writeString(view, 8, 'WAVE');
  writeString(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, format, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * numChannels * 2, true);
  view.setUint16(32, numChannels * 2, true);
  view.setUint16(34, bitDepth, true);
  writeString(view, 36, 'data');
  view.setUint32(40, length, true);
  
  const channelData = [];
  for (let i = 0; i < numChannels; i++) {
    channelData.push(buffer.getChannelData(i));
  }
  
  let offset = 44;
  for (let i = 0; i < buffer.length; i++) {
    for (let ch = 0; ch < numChannels; ch++) {
      const sample = channelData[ch][i];
      const s = Math.max(-1, Math.min(1, sample));
      view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
      offset += 2;
    }
  }
  
  return new Blob([view], { type: 'audio/wav' });
};

const App: React.FC = () => {
  // State
  const [text, setText] = useState<string>("");
  const [selectedEmotion, setSelectedEmotion] = useState<Emotion>(Emotion.NEUTRAL);
  const [selectedVoice, setSelectedVoice] = useState<VoiceName>(VoiceName.Puck);
  const [playbackRate, setPlaybackRate] = useState<number>(1.0);
  const [pitchShift, setPitchShift] = useState<number>(0); // In Cents
  const [emphasis, setEmphasis] = useState<number>(0); // Gain for peaking filter
  
  const [processing, setProcessing] = useState<ProcessingState>({
    isThinking: false,
    isSynthesizing: false,
    progress: 0,
    statusMessage: ''
  });
  
  const [historyOpen, setHistoryOpen] = useState(false);
  const [history, setHistory] = useState<HistoryItem[]>([]);

  // API Key State
  const [apiKey, setApiKey] = useState<string>("");
  const [tempApiKey, setTempApiKey] = useState<string>("");
  const [isApiConnected, setIsApiConnected] = useState<boolean>(false);

  // Audio Engine State
  const [audioContext, setAudioContext] = useState<AudioContext | null>(null);
  const [sourceNode, setSourceNode] = useState<AudioBufferSourceNode | null>(null);
  const [filterNode, setFilterNode] = useState<BiquadFilterNode | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [audioBuffer, setAudioBuffer] = useState<AudioBuffer | null>(null);
  const [currentWordIndex, setCurrentWordIndex] = useState<number>(-1);
  const startTimeRef = useRef<number>(0);
  const animationFrameRef = useRef<number>(0);

  // Initialize History
  useEffect(() => {
    loadHistory();
  }, []);

  const loadHistory = async () => {
    try {
        const items = await getHistoryItems();
        setHistory(items);
    } catch(e) {
        console.error("Failed to load history", e);
    }
  };

  const handleConnectApi = () => {
      if (tempApiKey.trim().length > 0) {
          setApiKey(tempApiKey.trim());
          setIsApiConnected(true);
      }
  };

  const handleDisconnectApi = () => {
      setApiKey("");
      setTempApiKey("");
      setIsApiConnected(false);
  };

  const initAudio = () => {
    if (!audioContext) {
      const ctx = new (window.AudioContext || (window as any).webkitAudioContext)({sampleRate: 24000});
      setAudioContext(ctx);
      
      // Create global filter node for emphasis
      const filter = ctx.createBiquadFilter();
      filter.type = "peaking";
      filter.frequency.value = 3000; // Human speech presence range
      filter.Q.value = 1.0;
      filter.gain.value = 0;
      filter.connect(ctx.destination);
      setFilterNode(filter);
    }
  };

  // Update Audio Params in Real-time
  useEffect(() => {
    if (sourceNode) {
        try {
            sourceNode.playbackRate.value = playbackRate;
            sourceNode.detune.value = pitchShift;
        } catch(e) {}
    }
    if (filterNode) {
        filterNode.gain.value = emphasis;
    }
  }, [playbackRate, pitchShift, emphasis, sourceNode, filterNode]);

  // Karaoke Loop
  useEffect(() => {
    if (isPlaying && audioBuffer && audioContext) {
        const words = text.replace(/<[^>]*>/g, '').split(/\s+/); // Crude split on spaces, ignoring tags
        const duration = audioBuffer.duration / playbackRate;
        
        const updateKaraoke = () => {
            const elapsed = audioContext.currentTime - startTimeRef.current;
            const progress = Math.min(1, elapsed / duration);
            const index = Math.floor(progress * words.length);
            setCurrentWordIndex(index);
            
            if (elapsed < duration) {
                animationFrameRef.current = requestAnimationFrame(updateKaraoke);
            }
        };
        animationFrameRef.current = requestAnimationFrame(updateKaraoke);
    } else {
        cancelAnimationFrame(animationFrameRef.current);
        setCurrentWordIndex(-1);
    }
    return () => cancelAnimationFrame(animationFrameRef.current);
  }, [isPlaying, audioContext, audioBuffer, text, playbackRate]);


  const handleOptimization = async (deep: boolean) => {
    if (!isApiConnected) {
        alert("Please connect your Gemini API Key below first.");
        return;
    }
    if (!text.trim()) return;
    initAudio();
    
    setProcessing({
      isThinking: true,
      isSynthesizing: false,
      progress: 30,
      statusMessage: deep ? "Engaging Gemini 3.0 Pro Thinking Protocol..." : "Polishing text..."
    });

    try {
      let optimized: string;
      if (deep) {
        optimized = await optimizeTextWithThinking(text, selectedEmotion, apiKey);
      } else {
        optimized = await quickPolishText(text, apiKey);
      }
      setText(optimized);
      setProcessing(prev => ({ ...prev, isThinking: false, progress: 100, statusMessage: "Optimization Complete" }));
      setTimeout(() => setProcessing({ isThinking: false, isSynthesizing: false, progress: 0, statusMessage: '' }), 2000);
    } catch (error) {
      console.error(error);
      setProcessing({ isThinking: false, isSynthesizing: false, progress: 0, statusMessage: "Optimization Failed: Check API Key" });
    }
  };

  const handleSynthesis = async () => {
    if (!isApiConnected) {
        alert("Please connect your Gemini API Key below first.");
        return;
    }
    if (!text.trim()) return;
    initAudio(); // Ensure context exists
    
    if (sourceNode) {
      try { sourceNode.stop(); } catch(e) {}
    }
    setIsPlaying(false);

    setProcessing({
      isThinking: false,
      isSynthesizing: true,
      progress: 50,
      statusMessage: "Synthesizing High-Fidelity Audio..."
    });

    try {
      // Use existing context
      const ctx = audioContext || new (window.AudioContext || (window as any).webkitAudioContext)({sampleRate: 24000});
      if(!audioContext) setAudioContext(ctx);

      const buffer = await synthesizeSpeech(text, selectedEmotion, selectedVoice, ctx, apiKey);
      setAudioBuffer(buffer);
      
      // Save to History
      const wavBlob = audioBufferToWav(buffer);
      const newItem: HistoryItem = {
          id: Date.now().toString(),
          text: text, // Save the optimized/tagged text
          originalText: text.replace(/<[^>]*>/g, ''), // Save plain text for preview
          emotion: selectedEmotion,
          voice: selectedVoice,
          timestamp: Date.now(),
          audioBlob: wavBlob
      };
      await saveHistoryItem(newItem);
      loadHistory(); // Refresh sidebar

      setProcessing({
        isThinking: false,
        isSynthesizing: false,
        progress: 100,
        statusMessage: "Ready to Play"
      });
      
      playAudio(buffer, ctx);

    } catch (error) {
      console.error(error);
      setProcessing({ isThinking: false, isSynthesizing: false, progress: 0, statusMessage: "Synthesis Failed: Check API Key" });
    }
  };

  const playAudio = (buffer: AudioBuffer | null, ctx: AudioContext | null) => {
    if (!buffer || !ctx) return;
    
    if (sourceNode) {
        try { sourceNode.stop(); } catch(e) {}
    }

    // Ensure filter exists (race condition check)
    let filter = filterNode;
    if (!filter) {
        filter = ctx.createBiquadFilter();
        filter.type = "peaking";
        filter.frequency.value = 3000;
        filter.Q.value = 1.0;
        filter.connect(ctx.destination);
        setFilterNode(filter);
    }

    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.playbackRate.value = playbackRate;
    source.detune.value = pitchShift;
    source.connect(filter!); // Source -> Filter -> Dest
    source.onended = () => setIsPlaying(false);
    
    startTimeRef.current = ctx.currentTime;
    source.start();
    setSourceNode(source);
    setIsPlaying(true);
  };

  const restoreHistoryItem = async (item: HistoryItem) => {
      setText(item.text);
      setSelectedEmotion(item.emotion);
      setSelectedVoice(item.voice);
      
      // Decode audio
      const arrayBuffer = await item.audioBlob.arrayBuffer();
      if (audioContext) {
          const buffer = await audioContext.decodeAudioData(arrayBuffer);
          setAudioBuffer(buffer);
          // Don't auto play, just load
      }
      setHistoryOpen(false);
  };

  const deleteHistory = async (id: string) => {
      await deleteHistoryItem(id);
      loadHistory();
  };

  const handleDownload = (format: 'wav' | 'ogg') => {
    if (!audioBuffer) return;
    
    if (format === 'ogg' && (window as any).MediaRecorder) {
        alert("High-quality OGG export requires external libraries. Downloading standard WAV instead.");
        handleDownload('wav');
        return;
    }

    const wavBlob = audioBufferToWav(audioBuffer);
    const url = URL.createObjectURL(wavBlob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `bengali-voice-${Date.now()}.${format}`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  // Render Karaoke Text
  const renderEditor = () => {
    if (isPlaying) {
        const words = text.replace(/<[^>]*>/g, '').split(/\s+/);
        return (
            <div className="w-full flex-grow p-5 text-xl font-serif leading-loose overflow-y-auto bg-black/40 text-gray-400 rounded-lg">
                {words.map((word, i) => (
                    <span key={i} className={`inline-block mr-2 transition-colors duration-200 ${i === currentWordIndex ? 'text-cyan-400 scale-110 font-bold' : ''} ${i < currentWordIndex ? 'text-gray-600' : ''}`}>
                        {word}
                    </span>
                ))}
            </div>
        );
    }
    return (
        <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="বাংলা টেক্সট এখানে লিখুন... (Type Bengali here)"
            className="w-full flex-grow bg-transparent p-5 text-xl text-gray-100 placeholder-gray-700 focus:outline-none resize-none font-serif leading-loose"
        />
    );
  };

  return (
    <div className="min-h-screen neural-gradient flex flex-col items-center p-4 md:p-8 font-sans relative overflow-x-hidden">
      <HistorySidebar 
        isOpen={historyOpen} 
        onClose={() => setHistoryOpen(false)} 
        history={history}
        onRestore={restoreHistoryItem}
        onDelete={deleteHistory}
      />

      <header className="w-full max-w-5xl flex justify-between items-center mb-8 border-b border-white/10 pb-4">
        <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-cyan-500 rounded-full flex items-center justify-center shadow-[0_0_20px_rgba(34,211,238,0.5)]">
                <SpeakerWaveIcon className="w-6 h-6 text-black" />
            </div>
            <div>
                <h1 className="text-2xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-cyan-400 to-blue-500">
                Bengali Neural Voice
                </h1>
                <div className="flex items-center gap-2 mt-0.5">
                    <p className="text-xs text-gray-400 tracking-widest uppercase">Gemini Powered Engine</p>
                    <span className="w-1 h-1 rounded-full bg-gray-600"></span>
                    <p className="text-[10px] tracking-[0.2em] font-bold text-transparent bg-clip-text bg-gradient-to-r from-cyan-500 to-purple-500 opacity-80 uppercase">
                        Created by Raw & Fun
                    </p>
                </div>
            </div>
        </div>
        <div className="flex gap-2">
            <button 
                onClick={() => setHistoryOpen(true)}
                className="flex items-center gap-1 px-3 py-1 rounded bg-white/5 hover:bg-white/10 border border-white/10 text-xs text-gray-300 transition-colors"
            >
                <ClockIcon className="w-3 h-3" /> History
            </button>
            <span className="px-2 py-1 rounded bg-blue-900/30 border border-blue-500/30 text-[10px] text-blue-300">
                V 2.5 TTS
            </span>
             <span className="px-2 py-1 rounded bg-purple-900/30 border border-purple-500/30 text-[10px] text-purple-300">
                V 3.0 THINKING
            </span>
        </div>
      </header>

      <main className="w-full max-w-5xl grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Column: Voice Gallery & Controls (5 Cols) */}
        <div className="lg:col-span-5 space-y-6">
            
            {/* Voice Model Gallery */}
            <div className="bg-white/5 border border-white/10 rounded-2xl p-5 backdrop-blur-md">
                <h3 className="text-sm font-semibold text-gray-300 mb-4 flex items-center gap-2">
                    <MicrophoneIcon className="w-4 h-4 text-cyan-400" /> Neural Voice Model
                </h3>
                <div className="grid grid-cols-2 gap-3">
                    {Object.values(VoiceName).map(voice => {
                        const meta = VOICE_META[voice];
                        const isSelected = selectedVoice === voice;
                        return (
                            <button
                                key={voice}
                                onClick={() => setSelectedVoice(voice)}
                                className={`relative p-3 rounded-xl border text-left transition-all duration-300 group ${
                                    isSelected 
                                    ? `${meta.bg} ${meta.border} ring-1 ring-white/20 shadow-lg` 
                                    : 'bg-black/20 border-white/5 hover:border-white/10 hover:bg-black/40'
                                }`}
                            >
                                <div className="flex items-start justify-between mb-1">
                                    <div className={`w-8 h-8 rounded-lg flex items-center justify-center bg-black/40 ${isSelected ? 'shadow-inner' : ''}`}>
                                        <SignalIcon className={`w-4 h-4 ${meta.iconColor}`} />
                                    </div>
                                    {isSelected && (
                                        <div className="absolute top-3 right-3 w-2 h-2 rounded-full bg-cyan-400 animate-pulse shadow-[0_0_10px_rgba(34,211,238,0.8)]"></div>
                                    )}
                                </div>
                                <div className={`font-semibold text-sm ${isSelected ? 'text-white' : 'text-gray-400 group-hover:text-gray-200'}`}>
                                    {meta.label}
                                </div>
                                <div className="text-[10px] text-gray-500 mt-1 leading-tight">
                                    {meta.desc}
                                </div>
                            </button>
                        );
                    })}
                </div>
            </div>

            {/* Neural Parameters */}
            <div className="bg-white/5 border border-white/10 rounded-2xl p-5 backdrop-blur-md space-y-6">
                 {/* Emotion */}
                <div>
                    <label className="text-xs font-medium text-gray-400 mb-2 flex items-center gap-2">
                         <SparklesIcon className="w-3 h-3" /> Emotion Context
                    </label>
                    <div className="relative">
                        <select 
                            value={selectedEmotion}
                            onChange={(e) => setSelectedEmotion(e.target.value as Emotion)}
                            className="w-full appearance-none bg-black/40 border border-white/10 rounded-lg pl-3 pr-8 py-2.5 text-sm text-gray-200 focus:outline-none focus:border-cyan-500/50 focus:ring-1 focus:ring-cyan-900/50 transition-all"
                        >
                            {Object.values(Emotion).map(e => <option key={e} value={e}>{e}</option>)}
                        </select>
                        <div className="absolute right-3 top-3 pointer-events-none">
                            <AdjustmentsHorizontalIcon className="w-4 h-4 text-gray-500" />
                        </div>
                    </div>
                </div>

                {/* Advanced Audio Controls */}
                <div className="space-y-4 pt-2 border-t border-white/5">
                    {/* Speed */}
                    <div>
                        <div className="flex justify-between items-center mb-2">
                            <label className="text-xs font-medium text-gray-400 flex items-center gap-2">
                                <BoltIcon className="w-3 h-3" /> Rate
                            </label>
                            <span className="text-[10px] font-mono text-cyan-400">{playbackRate.toFixed(1)}x</span>
                        </div>
                        <input type="range" min="0.5" max="1.5" step="0.1" value={playbackRate}
                               onChange={(e) => setPlaybackRate(parseFloat(e.target.value))}
                               className="w-full h-1 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-cyan-500" />
                    </div>

                    {/* Pitch */}
                    <div>
                        <div className="flex justify-between items-center mb-2">
                            <label className="text-xs font-medium text-gray-400 flex items-center gap-2">
                                <MusicalNoteIcon className="w-3 h-3" /> Pitch Shift
                            </label>
                            <span className="text-[10px] font-mono text-purple-400">{pitchShift > 0 ? '+' : ''}{pitchShift}c</span>
                        </div>
                        <input type="range" min="-600" max="600" step="50" value={pitchShift}
                               onChange={(e) => setPitchShift(parseFloat(e.target.value))}
                               className="w-full h-1 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-purple-500" />
                    </div>

                    {/* Emphasis/Clarity */}
                    <div>
                        <div className="flex justify-between items-center mb-2">
                            <label className="text-xs font-medium text-gray-400 flex items-center gap-2">
                                <SwatchIcon className="w-3 h-3" /> Clarity Boost
                            </label>
                            <span className="text-[10px] font-mono text-emerald-400">+{emphasis}dB</span>
                        </div>
                        <input type="range" min="0" max="15" step="1" value={emphasis}
                               onChange={(e) => setEmphasis(parseFloat(e.target.value))}
                               className="w-full h-1 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-emerald-500" />
                    </div>
                </div>
            </div>
        </div>

        {/* Right Column: Input & Visualizer (7 Cols) */}
        <div className="lg:col-span-7 space-y-6 flex flex-col">
            {/* Interactive Editor Area */}
            <div className="bg-white/5 border border-white/10 rounded-2xl p-1 backdrop-blur-md flex-grow flex flex-col min-h-[450px] shadow-xl relative overflow-hidden">
                <div className="p-3 border-b border-white/5 flex justify-between items-center bg-black/20 rounded-t-xl z-10">
                    <span className="text-[10px] text-gray-500 font-mono uppercase tracking-wider flex items-center gap-2">
                        <span className={`w-1.5 h-1.5 rounded-full ${isPlaying ? 'bg-red-500 animate-pulse' : 'bg-emerald-500'}`}></span>
                        {isPlaying ? 'LIVE_PLAYBACK' : 'INPUT_MODE'}
                    </span>
                    <button 
                        onClick={() => setText(SAMPLE_TEXTS[Math.floor(Math.random() * SAMPLE_TEXTS.length)])}
                        disabled={isPlaying}
                        className="text-[10px] px-2.5 py-1 bg-white/5 hover:bg-white/10 border border-white/5 rounded-full text-gray-400 transition-colors disabled:opacity-30"
                    >
                        Random Sample
                    </button>
                </div>
                
                {renderEditor()}
                
                {/* AI Tools Bar */}
                <div className="p-4 border-t border-white/5 bg-black/20 rounded-b-xl flex flex-wrap gap-4 items-center justify-between z-10">
                    <div className="flex gap-2">
                        <button
                            onClick={() => handleOptimization(false)}
                            disabled={processing.isThinking || processing.isSynthesizing || isPlaying}
                            className="flex items-center gap-2 px-3 py-2 rounded-lg bg-emerald-500/5 text-emerald-400 border border-emerald-500/10 hover:bg-emerald-500/10 hover:border-emerald-500/20 transition-all text-xs font-medium disabled:opacity-50"
                        >
                            <SparklesIcon className="w-3.5 h-3.5" />
                            Quick Polish
                        </button>
                        <button
                            onClick={() => handleOptimization(true)}
                            disabled={processing.isThinking || processing.isSynthesizing || isPlaying}
                            className="flex items-center gap-2 px-3 py-2 rounded-lg bg-purple-500/5 text-purple-400 border border-purple-500/10 hover:bg-purple-500/10 hover:border-purple-500/20 transition-all text-xs font-medium disabled:opacity-50"
                        >
                            <CpuChipIcon className="w-3.5 h-3.5" />
                            Smart SSML
                        </button>
                    </div>
                    <button
                        onClick={handleSynthesis}
                        disabled={!text.trim() || processing.isSynthesizing || isPlaying}
                        className="flex items-center gap-2 px-6 py-2.5 rounded-lg bg-gradient-to-r from-cyan-600 to-blue-600 text-white font-semibold shadow-lg shadow-cyan-900/20 hover:shadow-cyan-500/30 hover:scale-[1.02] active:scale-[0.98] transition-all disabled:opacity-50 disabled:scale-100"
                    >
                        {processing.isSynthesizing ? (
                             <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                        ) : (
                            <BoltIcon className="w-5 h-5" />
                        )}
                        Synthesize
                    </button>
                </div>
            </div>

            {/* Status & Visualizer */}
            <div className="space-y-4">
                {processing.isThinking && <ThinkingIndicator message={processing.statusMessage} />}
                
                {!processing.isThinking && processing.statusMessage && (
                     <div className="text-center text-xs text-cyan-500/80 font-mono animate-pulse">
                        {processing.statusMessage}
                     </div>
                )}

                <div className="relative group">
                    <AudioVisualizer 
                        audioContext={audioContext} 
                        sourceNode={sourceNode} 
                        isPlaying={isPlaying} 
                    />
                    
                    {/* Playback Controls Overlay */}
                    {audioBuffer && (
                         <div className="absolute inset-0 flex items-center justify-center gap-4 opacity-0 group-hover:opacity-100 transition-opacity bg-black/40 backdrop-blur-[2px] rounded-lg">
                            <button
                                onClick={() => isPlaying ? sourceNode?.stop() : playAudio(audioBuffer, audioContext)}
                                className="w-12 h-12 rounded-full bg-cyan-500 hover:bg-cyan-400 text-black shadow-xl flex items-center justify-center transition-transform hover:scale-110"
                                title={isPlaying ? "Pause" : "Play"}
                            >
                                {isPlaying ? <PauseIcon className="w-6 h-6" /> : <PlayIcon className="w-6 h-6 ml-1" />}
                            </button>
                            <div className="flex gap-2">
                                <button
                                    onClick={() => handleDownload('wav')}
                                    className="w-10 h-10 rounded-full bg-white hover:bg-gray-200 text-black shadow-xl flex items-center justify-center transition-transform hover:scale-110"
                                    title="Export WAV"
                                >
                                    <span className="text-[8px] font-bold absolute top-1">WAV</span>
                                    <ArrowDownTrayIcon className="w-4 h-4 mt-2" />
                                </button>
                                <button
                                    onClick={() => handleDownload('ogg')}
                                    className="w-10 h-10 rounded-full bg-orange-500 hover:bg-orange-400 text-white shadow-xl flex items-center justify-center transition-transform hover:scale-110"
                                    title="Export OGG"
                                >
                                    <span className="text-[8px] font-bold absolute top-1">OGG</span>
                                    <ArrowDownTrayIcon className="w-4 h-4 mt-2" />
                                </button>
                            </div>
                         </div>
                    )}
                </div>
            </div>
        </div>
      </main>

       {/* API Key Connection Bar */}
       <div className="w-full max-w-5xl mt-6 p-4 rounded-xl bg-white/5 border border-white/10 backdrop-blur-sm mb-8">
            <div className="flex flex-col md:flex-row items-center gap-4 justify-between">
                <div className="flex items-center gap-3 w-full md:w-auto">
                    <div className={`p-2 rounded-lg ${isApiConnected ? 'bg-emerald-500/20 text-emerald-400' : 'bg-gray-700/50 text-gray-400'}`}>
                        <CpuChipIcon className="w-5 h-5" />
                    </div>
                    <div className="flex-1 md:flex-none">
                        <h3 className="text-sm font-bold text-gray-200">Gemini API Connection</h3>
                        <p className="text-[10px] text-gray-500">
                            {isApiConnected ? 'Securely connected to Google AI' : 'Connect your API key to enable engine'}
                        </p>
                    </div>
                </div>

                {!isApiConnected ? (
                    <div className="flex w-full md:w-auto gap-2">
                        <input
                            type="password"
                            value={tempApiKey}
                            onChange={(e) => setTempApiKey(e.target.value)}
                            placeholder="Paste your Gemini API Key here..."
                            className="flex-1 md:w-64 bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-sm text-gray-200 placeholder-gray-600 focus:outline-none focus:border-cyan-500/50 transition-colors"
                        />
                        <button
                            onClick={handleConnectApi}
                            disabled={!tempApiKey.trim()}
                            className="px-4 py-2 bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 disabled:hover:bg-cyan-600 text-white text-xs font-bold rounded-lg transition-all"
                        >
                            Connect
                        </button>
                    </div>
                ) : (
                    <button
                        onClick={handleDisconnectApi}
                        className="flex items-center gap-2 px-4 py-2 bg-red-500/10 hover:bg-red-500/20 border border-red-500/20 text-red-400 text-xs font-bold rounded-lg transition-colors"
                    >
                        Disconnect
                    </button>
                )}
            </div>
        </div>
    </div>
  );
};

export default App;
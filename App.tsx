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
  KeyIcon,
  StopIcon,
  CheckBadgeIcon
} from '@heroicons/react/24/solid';

const VOICE_META = {
  [VoiceName.Puck]: { 
    label: "Puck",
    desc: "Energetic", 
    gradient: "from-cyan-400 to-blue-500", 
    iconColor: "text-cyan-400"
  },
  [VoiceName.Charon]: { 
    label: "Charon",
    desc: "Deep", 
    gradient: "from-indigo-400 to-purple-500", 
    iconColor: "text-indigo-400"
  },
  [VoiceName.Kore]: { 
    label: "Kore",
    desc: "Soothing", 
    gradient: "from-teal-400 to-emerald-500", 
    iconColor: "text-teal-400"
  },
  [VoiceName.Fenrir]: { 
    label: "Fenrir",
    desc: "Intense", 
    gradient: "from-red-400 to-orange-500", 
    iconColor: "text-red-400"
  },
  [VoiceName.Zephyr]: { 
    label: "Zephyr",
    desc: "Neutral", 
    gradient: "from-blue-400 to-indigo-500", 
    iconColor: "text-blue-400"
  },
};

// WAV Encoding Helper (Kept same as before)
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
      
      const filter = ctx.createBiquadFilter();
      filter.type = "peaking";
      filter.frequency.value = 3000; 
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
        const words = text.replace(/<[^>]*>/g, '').split(/\s+/); 
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
      statusMessage: deep ? "Thinking Protocol Active..." : "Polishing..."
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
      setProcessing({ isThinking: false, isSynthesizing: false, progress: 0, statusMessage: "Optimization Failed" });
    }
  };

  const handleSynthesis = async () => {
    if (!isApiConnected) {
        alert("Please connect your Gemini API Key first.");
        return;
    }
    if (!text.trim()) return;
    initAudio(); 
    
    if (sourceNode) {
      try { sourceNode.stop(); } catch(e) {}
    }
    setIsPlaying(false);

    setProcessing({
      isThinking: false,
      isSynthesizing: true,
      progress: 50,
      statusMessage: "Synthesizing Audio..."
    });

    try {
      const ctx = audioContext || new (window.AudioContext || (window as any).webkitAudioContext)({sampleRate: 24000});
      if(!audioContext) setAudioContext(ctx);

      const buffer = await synthesizeSpeech(text, selectedEmotion, selectedVoice, ctx, apiKey);
      setAudioBuffer(buffer);
      
      const wavBlob = audioBufferToWav(buffer);
      const newItem: HistoryItem = {
          id: Date.now().toString(),
          text: text,
          originalText: text.replace(/<[^>]*>/g, ''),
          emotion: selectedEmotion,
          voice: selectedVoice,
          timestamp: Date.now(),
          audioBlob: wavBlob
      };
      await saveHistoryItem(newItem);
      loadHistory(); 

      setProcessing({
        isThinking: false,
        isSynthesizing: false,
        progress: 100,
        statusMessage: "Ready"
      });
      
      playAudio(buffer, ctx);

    } catch (error) {
      console.error(error);
      setProcessing({ isThinking: false, isSynthesizing: false, progress: 0, statusMessage: "Synthesis Failed" });
    }
  };

  const playAudio = (buffer: AudioBuffer | null, ctx: AudioContext | null) => {
    if (!buffer || !ctx) return;
    
    if (sourceNode) {
        try { sourceNode.stop(); } catch(e) {}
    }

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
    source.connect(filter!); 
    source.onended = () => setIsPlaying(false);
    
    startTimeRef.current = ctx.currentTime;
    source.start();
    setSourceNode(source);
    setIsPlaying(true);
  };

  const handleStop = () => {
    if (sourceNode) {
        try { sourceNode.stop(); } catch(e) {}
        setIsPlaying(false);
    }
  };

  const restoreHistoryItem = async (item: HistoryItem) => {
      setText(item.text);
      setSelectedEmotion(item.emotion);
      setSelectedVoice(item.voice);
      const arrayBuffer = await item.audioBlob.arrayBuffer();
      if (audioContext) {
          const buffer = await audioContext.decodeAudioData(arrayBuffer);
          setAudioBuffer(buffer);
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
        alert("Downloading as WAV.");
        handleDownload('wav');
        return;
    }
    const wavBlob = audioBufferToWav(audioBuffer);
    const url = URL.createObjectURL(wavBlob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `voice-${Date.now()}.${format}`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const renderEditor = () => {
    if (isPlaying) {
        const words = text.replace(/<[^>]*>/g, '').split(/\s+/);
        return (
            <div className="w-full h-full p-6 text-2xl font-serif leading-loose overflow-y-auto text-gray-500 bg-black/20">
                {words.map((word, i) => (
                    <span key={i} className={`inline-block mr-2 transition-all duration-100 ${i === currentWordIndex ? 'text-cyan-400 scale-105 font-bold' : ''} ${i < currentWordIndex ? 'text-gray-700' : ''}`}>
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
            placeholder="বাংলা টেক্সট লিখুন..."
            className="w-full h-full bg-transparent p-6 text-xl text-gray-200 placeholder-gray-700 focus:outline-none resize-none font-serif leading-relaxed"
        />
    );
  };

  return (
    <div className="h-screen w-full neural-gradient flex flex-col text-gray-200 overflow-hidden">
      
      <HistorySidebar 
        isOpen={historyOpen} 
        onClose={() => setHistoryOpen(false)} 
        history={history}
        onRestore={restoreHistoryItem}
        onDelete={deleteHistory}
      />

      {/* --- Header --- */}
      <header className="h-16 flex-none bg-black/40 border-b border-white/10 backdrop-blur-md flex items-center justify-between px-6 z-20">
        <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-cyan-500 rounded-lg flex items-center justify-center shadow-[0_0_15px_rgba(6,182,212,0.5)]">
                <SpeakerWaveIcon className="w-5 h-5 text-black" />
            </div>
            <div>
                <h1 className="text-lg font-bold text-white tracking-tight">Bengali Neural Engine</h1>
                <div className="flex items-center gap-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
                    <p className="text-[10px] tracking-[0.2em] font-bold text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 to-violet-400 opacity-90 uppercase">
                        CREATED BY RAW & FUN
                    </p>
                </div>
            </div>
        </div>
        <div className="flex items-center gap-3">
            <div className={`px-3 py-1 rounded-full border flex items-center gap-2 text-xs font-medium transition-colors ${isApiConnected ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400' : 'bg-red-500/10 border-red-500/20 text-red-400'}`}>
                <div className={`w-2 h-2 rounded-full ${isApiConnected ? 'bg-emerald-500' : 'bg-red-500'}`}></div>
                {isApiConnected ? 'SYSTEM ONLINE' : 'API DISCONNECTED'}
            </div>
            <button onClick={() => setHistoryOpen(true)} className="p-2 rounded-lg hover:bg-white/10 text-gray-400 hover:text-white transition-colors">
                <ClockIcon className="w-5 h-5" />
            </button>
        </div>
      </header>

      {/* --- Main Dashboard --- */}
      <div className="flex-1 flex overflow-hidden p-4 gap-4">
        
        {/* LEFT COLUMN: Settings (Fixed Width) */}
        <div className="w-80 flex-none flex flex-col gap-4 overflow-hidden">
            {/* Voice Selector */}
            <div className="flex-1 bg-white/5 border border-white/10 rounded-2xl p-4 overflow-y-auto backdrop-blur-sm">
                <h3 className="text-xs font-bold text-gray-500 uppercase tracking-widest mb-3 flex items-center gap-2">
                    <MicrophoneIcon className="w-3 h-3" /> Voice Model
                </h3>
                <div className="space-y-2">
                    {Object.values(VoiceName).map(voice => {
                        const meta = VOICE_META[voice];
                        const isSelected = selectedVoice === voice;
                        return (
                            <button
                                key={voice}
                                onClick={() => setSelectedVoice(voice)}
                                className={`w-full p-3 rounded-xl border transition-all duration-200 flex items-center gap-3 ${
                                    isSelected 
                                    ? 'bg-cyan-500/10 border-cyan-500/50 shadow-[0_0_15px_rgba(6,182,212,0.1)]' 
                                    : 'bg-black/20 border-white/5 hover:bg-black/40 hover:border-white/20'
                                }`}
                            >
                                <div className={`w-8 h-8 rounded-lg flex items-center justify-center bg-black/40 ${isSelected ? meta.iconColor : 'text-gray-600'}`}>
                                    <SignalIcon className="w-4 h-4" />
                                </div>
                                <div className="text-left">
                                    <div className={`text-sm font-semibold ${isSelected ? 'text-white' : 'text-gray-400'}`}>{meta.label}</div>
                                    <div className="text-[10px] text-gray-600 uppercase">{meta.desc}</div>
                                </div>
                                {isSelected && <div className="ml-auto w-1.5 h-1.5 rounded-full bg-cyan-400 shadow-[0_0_8px_rgba(34,211,238,1)]"></div>}
                            </button>
                        );
                    })}
                </div>
            </div>

            {/* Audio Parameters */}
            <div className="h-auto bg-white/5 border border-white/10 rounded-2xl p-4 backdrop-blur-sm">
                <h3 className="text-xs font-bold text-gray-500 uppercase tracking-widest mb-4 flex items-center gap-2">
                    <AdjustmentsHorizontalIcon className="w-3 h-3" /> Tuning
                </h3>
                
                <div className="space-y-4">
                     {/* Emotion */}
                    <div>
                        <div className="flex justify-between mb-1">
                            <label className="text-[10px] text-gray-400">Emotion</label>
                        </div>
                        <select 
                            value={selectedEmotion}
                            onChange={(e) => setSelectedEmotion(e.target.value as Emotion)}
                            className="w-full bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-xs text-gray-200 focus:border-cyan-500/50 outline-none"
                        >
                            {Object.values(Emotion).map(e => <option key={e} value={e}>{e}</option>)}
                        </select>
                    </div>

                    {/* Sliders */}
                    {[
                        { label: 'Speed', icon: BoltIcon, val: playbackRate, set: setPlaybackRate, min: 0.5, max: 1.5, step: 0.1, fmt: (v: number) => `${v.toFixed(1)}x` },
                        { label: 'Pitch', icon: MusicalNoteIcon, val: pitchShift, set: setPitchShift, min: -600, max: 600, step: 50, fmt: (v: number) => `${v}c` },
                        { label: 'Clarity', icon: SwatchIcon, val: emphasis, set: setEmphasis, min: 0, max: 15, step: 1, fmt: (v: number) => `+${v}dB` }
                    ].map((ctrl, idx) => (
                        <div key={idx}>
                            <div className="flex justify-between mb-1">
                                <label className="text-[10px] text-gray-400 flex items-center gap-1">
                                    <ctrl.icon className="w-3 h-3" /> {ctrl.label}
                                </label>
                                <span className="text-[10px] font-mono text-cyan-400">{ctrl.fmt(ctrl.val)}</span>
                            </div>
                            <input 
                                type="range" min={ctrl.min} max={ctrl.max} step={ctrl.step} value={ctrl.val}
                                onChange={(e) => ctrl.set(parseFloat(e.target.value))}
                                className="w-full h-1 bg-gray-800 rounded-lg appearance-none cursor-pointer accent-cyan-500" 
                            />
                        </div>
                    ))}
                </div>
            </div>
        </div>

        {/* CENTER COLUMN: Editor (Flex Grow) */}
        <div className="flex-1 flex flex-col min-w-0 bg-white/5 border border-white/10 rounded-2xl overflow-hidden backdrop-blur-md relative shadow-2xl">
            {/* Editor Toolbar */}
            <div className="h-12 bg-black/20 border-b border-white/5 flex items-center justify-between px-4 flex-none">
                <span className="text-[10px] text-gray-500 font-mono uppercase tracking-wider flex items-center gap-2">
                    <span className={`w-1.5 h-1.5 rounded-full ${isPlaying ? 'bg-red-500 animate-ping' : 'bg-emerald-500'}`}></span>
                    {isPlaying ? 'ON_AIR' : 'INPUT_READY'}
                </span>
                <button 
                    onClick={() => setText(SAMPLE_TEXTS[Math.floor(Math.random() * SAMPLE_TEXTS.length)])}
                    disabled={isPlaying}
                    className="text-[10px] px-3 py-1 bg-white/5 hover:bg-white/10 rounded-full text-gray-400 transition-colors"
                >
                    Load Random Sample
                </button>
            </div>
            
            {/* Text Area */}
            <div className="flex-1 relative">
                {renderEditor()}
            </div>

            {/* AI Action Bar */}
            <div className="h-16 bg-black/40 border-t border-white/5 flex items-center justify-between px-6 flex-none">
                <div className="flex gap-2">
                    <button
                        onClick={() => handleOptimization(false)}
                        disabled={processing.isThinking || processing.isSynthesizing || isPlaying}
                        className="px-3 py-2 rounded-lg bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 transition-all text-xs font-medium flex items-center gap-2 border border-emerald-500/10"
                    >
                        <SparklesIcon className="w-4 h-4" /> Polish
                    </button>
                    <button
                        onClick={() => handleOptimization(true)}
                        disabled={processing.isThinking || processing.isSynthesizing || isPlaying}
                        className="px-3 py-2 rounded-lg bg-purple-500/10 text-purple-400 hover:bg-purple-500/20 transition-all text-xs font-medium flex items-center gap-2 border border-purple-500/10"
                    >
                        <CpuChipIcon className="w-4 h-4" /> Smart SSML
                    </button>
                </div>
                
                {processing.isThinking || processing.isSynthesizing ? (
                    <div className="flex items-center gap-3">
                        <span className="text-xs text-cyan-400 font-mono animate-pulse">{processing.statusMessage}</span>
                        <div className="w-5 h-5 border-2 border-cyan-500 border-t-transparent rounded-full animate-spin"></div>
                    </div>
                ) : (
                    <div className="text-xs text-gray-600 font-mono">
                        {text.length} chars
                    </div>
                )}
            </div>
        </div>

        {/* RIGHT COLUMN: Visuals & Actions (Fixed Width) */}
        <div className="w-80 flex-none flex flex-col gap-4">
            
            {/* Visualizer Card */}
            <div className="h-40 bg-black/40 border border-white/10 rounded-2xl overflow-hidden relative">
                <AudioVisualizer audioContext={audioContext} sourceNode={sourceNode} isPlaying={isPlaying} />
                <div className="absolute top-2 left-2 text-[10px] text-gray-500 font-mono">FREQ_ANALYZER</div>
            </div>

            {/* Primary Action Card */}
            <div className="flex-1 bg-white/5 border border-white/10 rounded-2xl p-6 flex flex-col items-center justify-center text-center backdrop-blur-sm gap-6">
                
                {!isPlaying ? (
                    <button
                        onClick={handleSynthesis}
                        disabled={!text.trim() || processing.isSynthesizing}
                        className="group relative w-32 h-32 rounded-full bg-gradient-to-b from-cyan-500 to-blue-600 flex items-center justify-center shadow-[0_0_40px_rgba(6,182,212,0.3)] hover:scale-105 active:scale-95 transition-all disabled:opacity-50 disabled:scale-100"
                    >
                        <BoltIcon className="w-12 h-12 text-white drop-shadow-lg" />
                        <div className="absolute inset-0 rounded-full border-2 border-white/20 animate-pulse"></div>
                    </button>
                ) : (
                    <button
                        onClick={handleStop}
                        className="group relative w-32 h-32 rounded-full bg-red-500/20 border-2 border-red-500 flex items-center justify-center shadow-[0_0_40px_rgba(239,68,68,0.2)] hover:bg-red-500/30 active:scale-95 transition-all"
                    >
                        <StopIcon className="w-12 h-12 text-red-500" />
                    </button>
                )}

                <div className="space-y-1">
                    <h2 className="text-xl font-bold text-white">
                        {isPlaying ? 'Playing Audio' : 'Synthesize'}
                    </h2>
                    <p className="text-xs text-gray-400">
                        {isPlaying ? 'Live playback active' : 'Click to generate neural speech'}
                    </p>
                </div>

                {audioBuffer && !isPlaying && (
                    <div className="flex gap-2 w-full mt-4">
                        <button onClick={() => handleDownload('wav')} className="flex-1 py-2 bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg text-xs font-medium text-gray-300 transition-colors flex items-center justify-center gap-2">
                            <ArrowDownTrayIcon className="w-3 h-3" /> WAV
                        </button>
                        <button onClick={() => handleDownload('ogg')} className="flex-1 py-2 bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg text-xs font-medium text-gray-300 transition-colors flex items-center justify-center gap-2">
                             <ArrowDownTrayIcon className="w-3 h-3" /> OGG
                        </button>
                    </div>
                )}
            </div>

            {/* API Connection (Bottom Right) */}
            <div className="bg-black/40 border border-white/10 rounded-2xl p-4">
                <h3 className="text-[10px] font-bold text-gray-500 uppercase mb-3 flex items-center gap-2">
                    <KeyIcon className="w-3 h-3" /> Secure Connection
                </h3>
                {!isApiConnected ? (
                    <div className="space-y-2">
                         <input
                            type="password"
                            value={tempApiKey}
                            onChange={(e) => setTempApiKey(e.target.value)}
                            placeholder="Paste API Key..."
                            className="w-full bg-white/5 border border-white/10 rounded px-2 py-1.5 text-xs text-gray-200 focus:border-cyan-500/50 outline-none"
                        />
                        <button
                            onClick={handleConnectApi}
                            disabled={!tempApiKey.trim()}
                            className="w-full py-1.5 bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-bold rounded transition-colors"
                        >
                            Connect
                        </button>
                    </div>
                ) : (
                    <button
                        onClick={handleDisconnectApi}
                        className="w-full py-2 bg-red-900/30 border border-red-500/30 hover:bg-red-900/50 text-red-400 text-xs font-bold rounded transition-colors"
                    >
                        Disconnect Key
                    </button>
                )}
            </div>
        </div>
      </div>
    </div>
  );
};

export default App;
// Worker code to handle audio encoding off the main thread
const workerCode = `
self.onmessage = function(e) {
  const { type, data, sampleRate } = e.data;
  
  if (type === 'ENCODE_WAV') {
    const wavBlob = encodeWAV(data, sampleRate);
    self.postMessage({ type: 'WAV_READY', blob: wavBlob });
  }
};

function writeString(view, offset, string) {
  for (let i = 0; i < string.length; i++) {
    view.setUint8(offset + i, string.charCodeAt(i));
  }
}

function encodeWAV(samples, sampleRate) {
  const numChannels = 1;
  const format = 1; // PCM
  const bitDepth = 16;
  
  const length = samples.length * numChannels * 2; 
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
  
  let offset = 44;
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
    offset += 2;
  }
  
  return new Blob([view], { type: 'audio/wav' });
}
`;

// Helper to create the worker instance
export const createAudioWorker = (): Worker => {
  const blob = new Blob([workerCode], { type: 'application/javascript' });
  return new Worker(URL.createObjectURL(blob));
};

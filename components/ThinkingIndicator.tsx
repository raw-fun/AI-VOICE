import React from 'react';

interface ThinkingIndicatorProps {
  message: string;
}

const ThinkingIndicator: React.FC<ThinkingIndicatorProps> = ({ message }) => {
  return (
    <div className="flex items-center gap-3 p-4 bg-blue-900/20 border border-blue-500/30 rounded-lg animate-pulse">
      <div className="relative w-6 h-6">
        <div className="absolute inset-0 border-2 border-cyan-400 rounded-full animate-spin border-t-transparent"></div>
        <div className="absolute inset-2 bg-blue-400 rounded-full animate-ping opacity-75"></div>
      </div>
      <span className="text-cyan-200 font-mono text-sm tracking-wide">{message}</span>
    </div>
  );
};

export default ThinkingIndicator;
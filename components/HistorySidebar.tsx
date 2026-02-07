import React from 'react';
import { HistoryItem } from '../types';
import { TrashIcon, ArrowPathIcon, PlayIcon, ArrowDownTrayIcon } from '@heroicons/react/24/solid';

interface HistorySidebarProps {
  isOpen: boolean;
  onClose: () => void;
  history: HistoryItem[];
  onRestore: (item: HistoryItem) => void;
  onDelete: (id: string) => void;
}

const HistorySidebar: React.FC<HistorySidebarProps> = ({ isOpen, onClose, history, onRestore, onDelete }) => {
  return (
    <div className={`fixed inset-y-0 right-0 w-80 bg-[#0f172a] border-l border-white/10 shadow-2xl transform transition-transform duration-300 z-50 ${isOpen ? 'translate-x-0' : 'translate-x-full'}`}>
      <div className="p-4 border-b border-white/10 flex justify-between items-center">
        <h2 className="text-lg font-bold text-white flex items-center gap-2">
            <ArrowPathIcon className="w-5 h-5 text-cyan-400" />
            Generation History
        </h2>
        <button onClick={onClose} className="text-gray-400 hover:text-white">✕</button>
      </div>

      <div className="p-4 overflow-y-auto h-[calc(100vh-64px)] space-y-4">
        {history.length === 0 && (
            <div className="text-center text-gray-500 py-10 italic">No history yet.</div>
        )}
        {history.map((item) => (
          <div key={item.id} className="bg-white/5 border border-white/5 rounded-lg p-3 hover:border-cyan-500/30 transition-colors group">
            <div className="flex justify-between items-start mb-2">
                <span className="text-[10px] uppercase tracking-wider text-cyan-400 bg-cyan-900/20 px-1.5 py-0.5 rounded border border-cyan-500/20">
                    {item.voice} • {item.emotion}
                </span>
                <span className="text-[10px] text-gray-500">
                    {new Date(item.timestamp).toLocaleTimeString()}
                </span>
            </div>
            <p className="text-sm text-gray-300 line-clamp-2 mb-3 font-serif leading-relaxed">
                {item.originalText}
            </p>
            <div className="flex gap-2 border-t border-white/5 pt-2">
                <button 
                    onClick={() => onRestore(item)}
                    className="flex-1 bg-cyan-600/20 hover:bg-cyan-600/30 text-cyan-400 text-xs py-1.5 rounded flex items-center justify-center gap-1 transition-colors"
                >
                    <PlayIcon className="w-3 h-3" /> Load
                </button>
                <button 
                    onClick={() => onDelete(item.id)}
                    className="w-8 bg-red-600/10 hover:bg-red-600/20 text-red-400 py-1.5 rounded flex items-center justify-center transition-colors"
                >
                    <TrashIcon className="w-3 h-3" />
                </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default HistorySidebar;
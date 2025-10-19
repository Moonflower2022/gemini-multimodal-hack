import React, { useState, useRef, useEffect, useCallback } from 'react';
import { TranscriptionStatus } from './types';
import { startLiveTranscription, isTextAQuestionAsync } from './services/geminiService';
import StatusIndicator from './components/StatusIndicator';

const MicIcon: React.FC<{className?: string}> = ({ className }) => (
  <svg className={className} xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor">
    <path d="M12 2a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3ZM11 5a1 1 0 0 1 2 0v8a1 1 0 0 1-2 0V5Z"></path>
    <path d="M12 15a5 5 0 0 0 5-5V5a1 1 0 0 0-2 0v5a3 3 0 0 1-6 0V5a1 1 0 0 0-2 0v5a5 5 0 0 0 5 5Z"></path>
    <path d="M19 10a1 1 0 0 0-1 1a6 6 0 0 1-12 0a1 1 0 0 0-2 0a8 8 0 0 0 8 8v3a1 1 0 0 0 2 0v-3a8 8 0 0 0 8-8a1 1 0 0 0-1-1Z"></path>
  </svg>
);

const StopIcon: React.FC<{className?: string}> = ({ className }) => (
  <svg className={className} xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor">
    <path d="M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2Zm0 18a8 8 0 1 1 8-8a8 8 0 0 1-8 8Z"></path>
    <path d="M16 8H8v8h8V8Z"></path>
  </svg>
);

interface Phrase {
  id: number;
  text: string;
  isFinal: boolean;
  isQuestion: boolean;
}

function App() {
  const [status, setStatus] = useState<TranscriptionStatus>(TranscriptionStatus.IDLE);
  const [phrases, setPhrases] = useState<Phrase[]>([]);
  const [error, setError] = useState<string | null>(null);

  const liveSessionRef = useRef<{ stop: () => void } | null>(null);
  const transcriptEndRef = useRef<HTMLDivElement>(null);
  const phraseIdCounter = useRef(0);

  const scrollToBottom = () => {
    transcriptEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [phrases]);

  const onTranscriptionUpdate = useCallback(async (text: string, isFinal: boolean) => {
    // Detect questions asynchronously
    const isCurrentTextQuestion = await isTextAQuestionAsync(text);

    setPhrases((prevPhrases) => {
      // Always append new text, never replace
      return [
        ...prevPhrases,
        {
          id: phraseIdCounter.current++,
          text,
          isFinal,
          isQuestion: isCurrentTextQuestion,
        },
      ];
    });
  }, []);

  const handleStart = async () => {
    setError(null);
    setPhrases([]);
    phraseIdCounter.current = 0;

    if (liveSessionRef.current) {
      liveSessionRef.current.stop();
      liveSessionRef.current = null;
    }

    try {
      const sessionControl = await startLiveTranscription({
        onTranscriptionUpdate,
        onStatusUpdate: setStatus,
        onError: (e: Error) => {
          console.error(e);
          setError(`An error occurred: ${e.message}`);
          setStatus(TranscriptionStatus.ERROR);
        }
      });
      liveSessionRef.current = sessionControl;
    } catch (e) {
      console.error("Failed to initialize transcription service", e);
      setError(`Failed to initialize transcription: ${(e as Error).message}`);
      setStatus(TranscriptionStatus.ERROR);
    }
  };

  const handleStop = () => {
    if (liveSessionRef.current) {
      liveSessionRef.current.stop();
      liveSessionRef.current = null;
      setStatus(TranscriptionStatus.STOPPED);
    }
  };

  useEffect(() => {
    // Cleanup on unmount
    return () => {
      liveSessionRef.current?.stop();
    };
  }, []);

  const isListening = status === TranscriptionStatus.LISTENING || status === TranscriptionStatus.CONNECTING;

  return (
    <div className="min-h-screen bg-gray-900 text-gray-100 flex flex-col items-center justify-center p-4 font-sans">
      <div className="w-full max-w-4xl flex flex-col h-[90vh]">
        <header className="text-center mb-6">
          <h1 className="text-4xl font-bold text-white">Gemini Live Transcription</h1>
          <p className="text-lg text-gray-400 mt-2">Speak into your microphone and see the magic happen in real-time.</p>
        </header>

        <div className="flex items-center justify-center space-x-6 mb-6">
          <StatusIndicator status={status} />
          <div className="flex space-x-4">
            <button
              onClick={handleStart}
              disabled={isListening}
              className="px-6 py-3 bg-blue-600 text-white font-semibold rounded-lg shadow-md hover:bg-blue-700 disabled:bg-gray-500 disabled:cursor-not-allowed transition-all duration-200 ease-in-out flex items-center space-x-2"
            >
              <MicIcon className="w-6 h-6"/>
              <span>Start</span>
            </button>
            <button
              onClick={handleStop}
              disabled={!isListening}
              className="px-6 py-3 bg-red-600 text-white font-semibold rounded-lg shadow-md hover:bg-red-700 disabled:bg-gray-500 disabled:cursor-not-allowed transition-all duration-200 ease-in-out flex items-center space-x-2"
            >
              <StopIcon className="w-6 h-6" />
              <span>Stop</span>
            </button>
          </div>
        </div>

        {error && <div className="text-red-400 bg-red-900/50 p-3 rounded-lg text-center mb-4">{error}</div>}
        
        <main className="flex-grow bg-gray-800 rounded-xl shadow-2xl p-6 overflow-y-auto font-mono text-lg leading-relaxed border border-gray-700">
          <p>
            {phrases.map(phrase => (
              <span key={phrase.id} className={phrase.isQuestion ? 'text-gray-900 font-semibold bg-yellow-200 rounded-md px-2 py-1' : (phrase.isFinal ? 'text-gray-200' : 'text-gray-400')}>
                {phrase.text}{' '}
              </span>
            ))}
          </p>
          <div ref={transcriptEndRef} />
        </main>

        <footer className="text-center mt-6 text-gray-500 text-sm">
          <p>Powered by Google Gemini</p>
        </footer>
      </div>
    </div>
  );
}

export default App;
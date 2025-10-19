import React, { useState, useRef, useEffect, useCallback } from 'react';
import { TranscriptionStatus } from './types';
import { startLiveTranscription, isTextAQuestionAsync } from './services/geminiService';
import { searchMemories, MemorySearchResult } from './services/vectorSearchService';
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
  questionGroupId?: number; // Links phrases that are part of the same question
  searchResults?: MemorySearchResult[]; // Search results for this question
}

function App() {
  const [status, setStatus] = useState<TranscriptionStatus>(TranscriptionStatus.IDLE);
  const [phrases, setPhrases] = useState<Phrase[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [sidebarWidth, setSidebarWidth] = useState(384); // 384px = w-96
  const [minThreshold, setMinThreshold] = useState(0.5); // Minimum match score (0-1)
  const [maxResults, setMaxResults] = useState(3); // Number of results to show

  const liveSessionRef = useRef<{ stop: () => void } | null>(null);
  const transcriptEndRef = useRef<HTMLDivElement>(null);
  const phraseIdCounter = useRef(0);
  const currentQuestionGroup = useRef<number | null>(null);
  const questionGroupCounter = useRef(0);
  const accumulatedText = useRef<string>('');
  const isResizing = useRef(false);

  const scrollToBottom = () => {
    transcriptEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [phrases]);

  const onTranscriptionUpdate = useCallback((text: string, isFinal: boolean) => {
    // Capture current values to use in async callback
    const currentMaxResults = maxResults;
    const currentMinThreshold = minThreshold;
    // Check if this chunk contains sentence-ending punctuation
    const hasPunctuation = /[.?!]/.test(text);

    // Create or continue a question group for related phrases
    if (currentQuestionGroup.current === null) {
      currentQuestionGroup.current = questionGroupCounter.current++;
    }

    const groupId = currentQuestionGroup.current;

    // Accumulate text across updates within the same group (text already has spaces)
    accumulatedText.current += text;

    // Add this chunk to the display IMMEDIATELY (no await)
    setPhrases((prevPhrases) => {
      return [
        ...prevPhrases,
        {
          id: phraseIdCounter.current++,
          text,
          isFinal,
          isQuestion: false,
          questionGroupId: groupId,
        },
      ];
    });

    // When sentence ends (punctuation detected), check if accumulated text is a question
    if (hasPunctuation) {
      const fullText = accumulatedText.current;

      // Run question detection in background without blocking
      isTextAQuestionAsync(fullText).then(async isCurrentTextQuestion => {
        if (isCurrentTextQuestion) {
          // Query the database for relevant memories
          let searchResults: MemorySearchResult[] = [];
          try {
            console.log('🔍 Searching database for:', fullText, 'with limit:', currentMaxResults);
            const allResults = await searchMemories(fullText, currentMaxResults);
            // Filter by minimum threshold
            searchResults = allResults.filter(result => result.score >= currentMinThreshold);
            console.log('✅ Found', searchResults.length, 'relevant memories (filtered by threshold)');
          } catch (error) {
            console.error('❌ Error searching memories:', error);
          }

          // Mark all phrases in this question group and add search results
          setPhrases((prevPhrases) => {
            return prevPhrases.map(phrase => {
              // Update phrases that are part of this question group
              if (phrase.questionGroupId === groupId) {
                return {
                  ...phrase,
                  isQuestion: true,
                  searchResults,
                };
              }
              return phrase;
            });
          });
        }
      });

      // Reset for next question/statement
      accumulatedText.current = '';
      currentQuestionGroup.current = null;
    }
  }, [maxResults, minThreshold]);

  const handleStart = async () => {
    setError(null);
    setPhrases([]);
    phraseIdCounter.current = 0;
    currentQuestionGroup.current = null;
    questionGroupCounter.current = 0;
    accumulatedText.current = '';

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

  // Handle resizing
  const handleMouseDown = () => {
    isResizing.current = true;
    document.body.style.cursor = 'col-resize';
  };

  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (!isResizing.current) return;

    const newWidth = window.innerWidth - e.clientX - 16; // 16px for padding
    if (newWidth >= 200) { // Only minimum constraint to keep it usable
      setSidebarWidth(newWidth);
    }
  }, []);

  const handleMouseUp = () => {
    isResizing.current = false;
    document.body.style.cursor = 'default';
  };

  useEffect(() => {
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [handleMouseMove]);

  const isListening = status === TranscriptionStatus.LISTENING || status === TranscriptionStatus.CONNECTING;

  // Generate a consistent color for each question group
  const getQuestionColor = (groupId: number) => {
    const colors = [
      'rgb(96, 165, 250)',  // blue
      'rgb(167, 139, 250)', // purple
      'rgb(251, 146, 60)',  // orange
      'rgb(34, 197, 94)',   // green
      'rgb(244, 114, 182)', // pink
      'rgb(251, 191, 36)',  // amber
    ];
    return colors[groupId % colors.length];
  };

  // Get all unique question groups with results
  const questionsWithResults = phrases
    .filter(p => p.isQuestion && p.searchResults && p.searchResults.length > 0)
    .reduce((acc, phrase) => {
      if (!acc.find(q => q.questionGroupId === phrase.questionGroupId)) {
        acc.push(phrase);
      }
      return acc;
    }, [] as Phrase[]);

  return (
    <div className="min-h-screen bg-gray-900 text-gray-100 flex flex-col p-4 font-sans">
      {/* Top Bar */}
      <header className="flex items-center justify-between mb-4 px-4 py-3 bg-gray-800 rounded-lg border border-gray-700">
        <h1 className="text-2xl font-bold text-white">OnCue</h1>

        <div className="flex items-center space-x-6">
          {/* Match Threshold Control */}
          <div className="flex items-center space-x-2">
            <label className="text-sm text-gray-400">Min Match:</label>
            <input
              type="range"
              min="0"
              max="100"
              value={minThreshold * 100}
              onChange={(e) => setMinThreshold(parseFloat(e.target.value) / 100)}
              className="w-24 h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-blue-500"
            />
            <span className="text-sm text-gray-300 w-10">{(minThreshold * 100).toFixed(0)}%</span>
          </div>

          {/* Number of Results Control */}
          <div className="flex items-center space-x-2">
            <label className="text-sm text-gray-400">Results:</label>
            <input
              type="number"
              min="1"
              max="10"
              value={maxResults}
              onChange={(e) => setMaxResults(parseInt(e.target.value) || 1)}
              className="w-16 px-2 py-1 bg-gray-700 text-gray-200 rounded border border-gray-600 text-sm"
            />
          </div>

          <StatusIndicator status={status} />
          <button
            onClick={handleStart}
            disabled={isListening}
            className="px-4 py-2 bg-blue-600 text-white font-semibold rounded-lg shadow-md hover:bg-blue-700 disabled:bg-gray-500 disabled:cursor-not-allowed transition-all duration-200 ease-in-out flex items-center space-x-2"
          >
            <MicIcon className="w-5 h-5"/>
            <span>Start</span>
          </button>
          <button
            onClick={handleStop}
            disabled={!isListening}
            className="px-4 py-2 bg-red-600 text-white font-semibold rounded-lg shadow-md hover:bg-red-700 disabled:bg-gray-500 disabled:cursor-not-allowed transition-all duration-200 ease-in-out flex items-center space-x-2"
          >
            <StopIcon className="w-5 h-5" />
            <span>Stop</span>
          </button>
        </div>
      </header>

      {error && <div className="text-red-400 bg-red-900/50 p-3 rounded-lg text-center mb-4">{error}</div>}

      {/* Main Content Area */}
      <div className="flex-grow flex overflow-hidden">
        {/* Transcription Panel */}
        <main className="flex-1 bg-gray-800 rounded-xl shadow-2xl p-6 overflow-y-auto font-mono text-lg leading-relaxed border border-gray-700">
          {phrases.map((phrase) => (
            <span
              key={phrase.id}
              className={phrase.isQuestion ? 'font-semibold rounded-md px-2 py-1' : (phrase.isFinal ? 'text-gray-200' : 'text-gray-400')}
              style={phrase.isQuestion ? {
                backgroundColor: getQuestionColor(phrase.questionGroupId!),
                color: 'rgb(17, 24, 39)'
              } : {}}
            >
              {phrase.text}{' '}
            </span>
          ))}
          <div ref={transcriptEndRef} />
        </main>

        {/* Resize Handle */}
        <div
          className="w-1 bg-gray-700 hover:bg-blue-500 cursor-col-resize transition-colors flex-shrink-0"
          onMouseDown={handleMouseDown}
        />

        {/* Context Clues Side Panel */}
        <aside
          className="bg-gray-800 rounded-xl shadow-2xl p-4 overflow-y-auto border border-gray-700 flex-shrink-0"
          style={{ width: `${sidebarWidth}px` }}
        >
          <h2 className="text-lg font-bold text-gray-200 mb-4">Context Clues</h2>
          <div className="space-y-4">
            {questionsWithResults.length === 0 ? (
              <p className="text-gray-500 text-sm italic">No context clues yet. Ask a question to see relevant information.</p>
            ) : (
              questionsWithResults.map((phrase) => (
                <div key={`context-${phrase.questionGroupId}`} className="space-y-2">
                  {/* Question indicator */}
                  <div
                    className="text-xs font-semibold px-2 py-1 rounded inline-block"
                    style={{
                      backgroundColor: getQuestionColor(phrase.questionGroupId!),
                      color: 'rgb(17, 24, 39)'
                    }}
                  >
                    Q: {phrases.filter(p => p.questionGroupId === phrase.questionGroupId).map(p => p.text).join('')}
                  </div>

                  {/* Results */}
                  {phrase.searchResults!.map((result, resultIdx) => {
                    // Calculate brightness based on score (0-1 range, higher = brighter)
                    const brightness = Math.min(result.score, 1);
                    const borderWidth = Math.ceil(brightness * 4); // 1-4px based on score

                    return (
                      <div
                        key={resultIdx}
                        className="bg-gray-700 rounded p-3 text-sm transition-all hover:bg-gray-650"
                        style={{
                          borderLeft: `${borderWidth}px solid ${getQuestionColor(phrase.questionGroupId!)}`,
                          opacity: 0.5 + (brightness * 0.5) // 50-100% opacity based on score
                        }}
                      >
                        <div className="flex justify-between items-start mb-1">
                          <span className="text-purple-300 font-semibold text-xs uppercase">{result.classification}</span>
                          <span className="text-gray-400 text-xs">{(result.score * 100).toFixed(0)}%</span>
                        </div>
                        <p className="text-gray-100 mb-1 leading-tight">{result.description}</p>
                        <div className="flex justify-between items-center text-xs text-gray-500 mt-2">
                          <span className="truncate">{result.sourceFile}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ))
            )}
          </div>
        </aside>
      </div>

      <footer className="text-center mt-4 text-gray-500 text-xs">
        <p>Powered by Google Gemini</p>
      </footer>
    </div>
  );
}

export default App;
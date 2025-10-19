import { GoogleGenAI, LiveSession, Modality, Blob, LiveServerMessage } from '@google/genai';
import { TranscriptionStatus } from '../types';
import { encode } from '../utils/audioUtils';

// ============================================
// DETECTION MODE - CHANGE THIS TO SWITCH MODES
// ============================================
//
// Two modes available for detecting interview questions:
//
// 1. 'KEYWORD' - Fast keyword-based detection
//    - Looks for question marks, "experience", "skill", "tell me about", etc.
//    - Instant detection, no API calls
//    - Best for: Quick responses, low latency
//
// 2. 'LLM' - AI-powered semantic analysis
//    - Uses Gemini AI to understand context and meaning
//    - More accurate at detecting subtle questions and conversation points
//    - Has caching to reduce API calls
//    - Best for: More nuanced detection, complex questions
//
type DetectionMode = 'KEYWORD' | 'LLM';
const DETECTION_MODE: DetectionMode = 'KEYWORD'; // Change to 'LLM' for AI-based detection

// Constants for audio processing
const BUFFER_SIZE = 4096;
const INPUT_SAMPLE_RATE = 16000;

interface LiveTranscriptionCallbacks {
  onTranscriptionUpdate: (text: string, isFinal: boolean) => void;
  onStatusUpdate: (status: TranscriptionStatus) => void;
  onError: (error: Error) => void;
}

// Store refs to clean up on stop
let audioContext: AudioContext | null = null;
let mediaStream: MediaStream | null = null;
let scriptProcessor: ScriptProcessorNode | null = null;
let mediaStreamSource: MediaStreamAudioSourceNode | null = null;
let session: LiveSession | null = null;

const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

/**
 * KEYWORD MODE: Detects interview questions and conversation points using keyword matching
 * Looks for common interview-related keywords and patterns
 */
function detectWithKeywords(text: string): boolean {
  console.log("run on ", text)
  const lowerText = text.toLowerCase().trim();

  // Check for question mark
  if (lowerText.includes('?')) {
    console.log('🎯 [KEYWORD MODE] Question detected (ends with ?):', text);
    return true;
  }

  // Interview-specific keywords
  const interviewKeywords = [
    'experience',
    'skill',
    'skills',
    'background',
    'qualification',
    'qualifications',
    'tell me about',
    'describe',
    'explain',
    'walk me through',
    'how would you',
    'what would you',
    'why did you',
    'when did you',
    'where did you',
    'have you ever',
    'can you',
    'could you',
    'would you',
    'do you have',
    'what is your',
    'strengths',
    'weaknesses',
    'challenge',
    'project',
    'team',
    'leadership',
    'conflict',
    'situation',
    'example',
    'greatest achievement',
    'why should we',
  ];

  const matchedKeyword = interviewKeywords.find(keyword => lowerText.includes(keyword));
  if (matchedKeyword) {
    console.log(`🎯 [KEYWORD MODE] Question detected (keyword: "${matchedKeyword}"):`, text);
    return true;
  }

  return false;
}

/**
 * LLM MODE: Uses AI to analyze if text represents an interview question or important conversation point
 * This function will be called asynchronously and caches results
 */
const llmCache = new Map<string, boolean>();

async function detectWithLLM(text: string): Promise<boolean> {
  // Check cache first
  if (llmCache.has(text)) {
    const cachedResult = llmCache.get(text)!;
    console.log('🎯 [LLM MODE] Question detection (from cache):', cachedResult ? 'YES' : 'NO', '-', text);
    return cachedResult;
  }

  try {
    const model = ai.getGenerativeModel({ model: 'gemini-2.0-flash-exp' });
    const prompt = `Analyze this text and determine if it's an interview question or important conversation point that an interviewee would want help with.

Text: "${text}"

Consider it a "yes" if it:
- Is a direct question
- Asks about experience, skills, or qualifications
- Requests examples or explanations
- Discusses challenges, projects, or achievements
- Is a behavioral interview question
- Is a technical question
- Asks "tell me about" or similar prompts

Respond with ONLY "yes" or "no".`;

    const result = await model.generateContent(prompt);
    const response = result.response.text().toLowerCase().trim();
    const isQuestion = response.includes('yes');

    console.log(`🎯 [LLM MODE] Question detected via AI analysis: ${isQuestion ? 'YES' : 'NO'} - "${text}"`);

    // Cache the result
    llmCache.set(text, isQuestion);

    // Limit cache size to prevent memory issues
    if (llmCache.size > 100) {
      const firstKey = llmCache.keys().next().value;
      llmCache.delete(firstKey);
    }

    return isQuestion;
  } catch (error) {
    console.error('🎯 [LLM MODE] Detection error:', error);
    // Fallback to keyword detection on error
    return detectWithKeywords(text);
  }
}

/**
 * Checks if a given text is a question or interview conversation point (synchronous - for KEYWORD mode).
 * Uses the mode specified by DETECTION_MODE constant.
 * @param text The text to analyze.
 * @returns True if the text is a question/conversation point, false otherwise.
 */
export function isTextAQuestion(text: string): boolean {
  return detectWithKeywords(text);
}

/**
 * Checks if a given text is a question or interview conversation point (async - supports both modes).
 * Uses the mode specified by DETECTION_MODE constant.
 * @param text The text to analyze.
 * @returns Promise that resolves to true if the text is a question/conversation point, false otherwise.
 */
export async function isTextAQuestionAsync(text: string): Promise<boolean> {
  if (DETECTION_MODE === 'KEYWORD') {
    return detectWithKeywords(text);
  } else {
    return detectWithLLM(text);
  }
}


export async function startLiveTranscription(callbacks: LiveTranscriptionCallbacks): Promise<{ stop: () => void }> {
  callbacks.onStatusUpdate(TranscriptionStatus.CONNECTING);

  try {
    mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });

    const sessionPromise = ai.live.connect({
      model: 'gemini-2.5-flash-native-audio-preview-09-2025',
      callbacks: {
        onopen: () => {
          callbacks.onStatusUpdate(TranscriptionStatus.LISTENING);
          
          audioContext = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: INPUT_SAMPLE_RATE });
          mediaStreamSource = audioContext.createMediaStreamSource(mediaStream!);
          scriptProcessor = audioContext.createScriptProcessor(BUFFER_SIZE, 1, 1);

          scriptProcessor.onaudioprocess = (audioProcessingEvent: AudioProcessingEvent) => {
            // Only process audio if session is still active
            if (!session) return;

            const inputData = audioProcessingEvent.inputBuffer.getChannelData(0);

            // Convert Float32Array to Int16Array and then to base64
            const l = inputData.length;
            const int16 = new Int16Array(l);
            for (let i = 0; i < l; i++) {
              int16[i] = inputData[i] * 32768;
            }
            const pcmBlob: Blob = {
              data: encode(new Uint8Array(int16.buffer)),
              mimeType: `audio/pcm;rate=${INPUT_SAMPLE_RATE}`,
            };

            try {
              session.sendRealtimeInput({ media: pcmBlob });
            } catch (error) {
              console.error('Error sending audio data:', error);
            }
          };

          mediaStreamSource.connect(scriptProcessor);
          scriptProcessor.connect(audioContext.destination);
        },
        onmessage: (message: LiveServerMessage) => {
          if (message.serverContent?.inputTranscription) {
            const { text, isFinal } = message.serverContent.inputTranscription;
            callbacks.onTranscriptionUpdate(text, isFinal ?? false);
          }
        },
        onerror: (e: ErrorEvent) => {
          callbacks.onError(new Error(e.message));
          callbacks.onStatusUpdate(TranscriptionStatus.ERROR);
        },
        onclose: (e: CloseEvent) => {
           // This is called when stop() is invoked or if connection closes unexpectedly
        },
      },
      config: {
        responseModalities: [Modality.AUDIO],
        inputAudioTranscription: {},
      },
    });
    
    session = await sessionPromise;

    return { stop };

  } catch (error) {
    callbacks.onError(error as Error);
    callbacks.onStatusUpdate(TranscriptionStatus.ERROR);
    stop(); // Cleanup any partial setup
    throw error;
  }
}

function stop() {
  if (session) {
    session.close();
    session = null;
  }

  if (mediaStream) {
    mediaStream.getTracks().forEach(track => track.stop());
    mediaStream = null;
  }
  
  if (scriptProcessor) {
    scriptProcessor.disconnect();
    scriptProcessor = null;
  }

  if(mediaStreamSource) {
    mediaStreamSource.disconnect();
    mediaStreamSource = null;
  }

  if (audioContext && audioContext.state !== 'closed') {
    audioContext.close();
    audioContext = null;
  }
}
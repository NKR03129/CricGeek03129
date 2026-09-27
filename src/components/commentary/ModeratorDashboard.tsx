"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { Mic, MicOff, Send, Loader2, Pause, Play, StopCircle, Keyboard, Volume2 } from "lucide-react";
import { beautifyCommentaryText, finalizeCommentaryText } from "@/lib/commentary-format";

interface Entry {
  id: string;
  text: string;
  overText: string | null;
  source: string;
  createdAt: string;
}

interface ModeratorDashboardProps {
  sessionId: string;
  sessionStatus: string;
  onStatusChange: (status: string) => void;
  onEntryPosted: (entry: Entry) => void;
}

type RecorderSupport = {
  mimeType: string;
  extension: string;
};

interface SpeechRecognitionAlternativeLike {
  transcript: string;
}

interface SpeechRecognitionResultLike {
  isFinal: boolean;
  0: SpeechRecognitionAlternativeLike;
  length: number;
}

interface SpeechRecognitionEventLike extends Event {
  resultIndex: number;
  results: ArrayLike<SpeechRecognitionResultLike>;
}

interface SpeechRecognitionLike extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: Event & { error?: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
}

type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;

function getRecorderSupport(): RecorderSupport | null {
  if (typeof window === "undefined" || typeof MediaRecorder === "undefined") {
    return null;
  }

  const candidates: RecorderSupport[] = [
    { mimeType: "audio/webm;codecs=opus", extension: "webm" },
    { mimeType: "audio/webm", extension: "webm" },
    { mimeType: "audio/mp4;codecs=mp4a.40.2", extension: "mp4" },
    { mimeType: "audio/mp4", extension: "mp4" },
  ];

  for (const candidate of candidates) {
    if (MediaRecorder.isTypeSupported(candidate.mimeType)) {
      return candidate;
    }
  }

  return { mimeType: "", extension: "webm" };
}

function getSpeechRecognitionSupport(): SpeechRecognitionConstructor | null {
  if (typeof window === "undefined") {
    return null;
  }

  const speechWindow = window as Window & typeof globalThis & {
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
  };

  return speechWindow.SpeechRecognition || speechWindow.webkitSpeechRecognition || null;
}

function getMicrophoneErrorMessage(error: unknown): string {
  if (error instanceof DOMException) {
    if (error.name === "NotAllowedError" || error.name === "PermissionDeniedError") {
      return "Microphone access was blocked by the browser or system settings.";
    }
    if (error.name === "NotFoundError" || error.name === "DevicesNotFoundError") {
      return "No microphone was found on this device.";
    }
    if (error.name === "NotReadableError" || error.name === "TrackStartError") {
      return "Your microphone is busy in another app. Close the other app and try again.";
    }
    if (error.name === "SecurityError") {
      return "Microphone access requires a secure browser context. Try localhost or HTTPS.";
    }
  }

  if (error instanceof Error) {
    return error.message;
  }

  return "Unable to start microphone recording on this browser.";
}

export default function ModeratorDashboard({
  sessionId,
  sessionStatus,
  onStatusChange,
  onEntryPosted,
}: ModeratorDashboardProps) {
  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [isPosting, setIsPosting] = useState(false);
  const [transcribedText, setTranscribedText] = useState("");
  const [overText, setOverText] = useState("");
  const [inputMode, setInputMode] = useState<"voice" | "typed">("voice");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [audioLevel, setAudioLevel] = useState(0);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animationRef = useRef<number | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const recorderSupportRef = useRef<RecorderSupport | null>(null);
  const speechRecognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const recognitionSupportedRef = useRef(false);
  const isVoiceSessionActiveRef = useRef(false);
  const finalTranscriptRef = useRef("");
  const interimTranscriptRef = useRef("");
  const lastRecordedBlobRef = useRef<Blob | null>(null);

  const cleanupRecordingResources = useCallback(() => {
    if (animationRef.current) {
      cancelAnimationFrame(animationRef.current);
      animationRef.current = null;
    }

    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }

    analyserRef.current = null;
    setAudioLevel(0);

    if (audioContextRef.current) {
      void audioContextRef.current.close();
      audioContextRef.current = null;
    }
  }, []);

  const syncTranscriptState = useCallback(() => {
    const nextText = [finalTranscriptRef.current, interimTranscriptRef.current]
      .filter(Boolean)
      .join(" ")
      .trim();
    setTranscribedText(beautifyCommentaryText(nextText));
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      isVoiceSessionActiveRef.current = false;
      speechRecognitionRef.current?.stop();
      cleanupRecordingResources();
    };
  }, [cleanupRecordingResources]);

  const startRecording = useCallback(async () => {
    setError(null);
    setNotice(null);
    finalTranscriptRef.current = "";
    interimTranscriptRef.current = "";
    lastRecordedBlobRef.current = null;
    syncTranscriptState();
    try {
      const recognitionCtor = getSpeechRecognitionSupport();
      const recorderSupport = getRecorderSupport();

      if (!recognitionCtor && !navigator.mediaDevices?.getUserMedia) {
        throw new Error("This browser does not support microphone capture.");
      }

      if (!recognitionCtor && typeof MediaRecorder === "undefined") {
        throw new Error("This browser does not support live speech recognition or in-browser audio recording.");
      }

      if (!recognitionCtor && !recorderSupport) {
        throw new Error("This browser does not support the audio format needed for transcription.");
      }

      if (navigator.mediaDevices?.getUserMedia) {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        streamRef.current = stream;
        recorderSupportRef.current = recorderSupport;

        // Set up audio analyser for waveform visualisation
        const AudioContextCtor = window.AudioContext || (window as Window & typeof globalThis & {
          webkitAudioContext?: typeof AudioContext;
        }).webkitAudioContext;

        if (AudioContextCtor) {
          const audioCtx = new AudioContextCtor();
          audioContextRef.current = audioCtx;
          const source = audioCtx.createMediaStreamSource(stream);
          const analyser = audioCtx.createAnalyser();
          analyser.fftSize = 256;
          source.connect(analyser);
          analyserRef.current = analyser;

          // Animate audio level
          const dataArray = new Uint8Array(analyser.frequencyBinCount);
          const updateLevel = () => {
            analyser.getByteFrequencyData(dataArray);
            const avg = dataArray.reduce((a, b) => a + b, 0) / dataArray.length;
            setAudioLevel(avg / 255);
            animationRef.current = requestAnimationFrame(updateLevel);
          };
          updateLevel();
        }
      }

      if (streamRef.current && recorderSupport) {
        const recorder = recorderSupport.mimeType
          ? new MediaRecorder(streamRef.current, { mimeType: recorderSupport.mimeType })
          : new MediaRecorder(streamRef.current);
        chunksRef.current = [];

        recorder.ondataavailable = (e) => {
          if (e.data.size > 0) chunksRef.current.push(e.data);
        };

        recorder.onerror = () => {
          setError("Recording failed in this browser. Try typed mode or a Chromium browser.");
          cleanupRecordingResources();
          setIsRecording(false);
        };

        recorder.onstop = async () => {
          const fallbackText = [finalTranscriptRef.current, interimTranscriptRef.current]
            .filter(Boolean)
            .join(" ")
            .trim();
          cleanupRecordingResources();

          if (chunksRef.current.length === 0) {
            if (fallbackText) {
              setTranscribedText(finalizeCommentaryText(fallbackText));
            }
            return;
          }

          const blobType = recorder.mimeType || recorderSupport.mimeType || "audio/webm";
          const blob = new Blob(chunksRef.current, { type: blobType });
          lastRecordedBlobRef.current = blob;
          await transcribeAudio(blob, { fallbackText });
        };

        mediaRecorderRef.current = recorder;
        recorder.start();
      }

      if (recognitionCtor) {
        const recognition = new recognitionCtor();
        recognition.continuous = true;
        recognition.interimResults = true;
        recognition.lang = "en-US";

        recognition.onresult = (event) => {
          let finalText = finalTranscriptRef.current;
          let interimText = "";

          for (let i = event.resultIndex; i < event.results.length; i += 1) {
            const result = event.results[i];
            const transcript = result[0]?.transcript?.trim();
            if (!transcript) {
              continue;
            }

            if (result.isFinal) {
              finalText = [finalText, transcript].filter(Boolean).join(" ").trim();
            } else {
              interimText = [interimText, transcript].filter(Boolean).join(" ").trim();
            }
          }

          finalTranscriptRef.current = finalText;
          interimTranscriptRef.current = interimText;
          syncTranscriptState();
        };

        recognition.onerror = (event) => {
          if (event.error === "aborted" || event.error === "no-speech") {
            return;
          }

          if (event.error === "not-allowed" || event.error === "service-not-allowed") {
            setError("Live browser transcription was blocked. Check microphone and speech recognition permissions.");
          } else {
            setError("Live browser transcription failed. Recording fallback will still be used if available.");
          }
        };

        recognition.onend = () => {
          if (isVoiceSessionActiveRef.current) {
            try {
              recognition.start();
            } catch {
              setError("Live browser transcription stopped unexpectedly.");
            }
          }
        };

        speechRecognitionRef.current = recognition;
        recognitionSupportedRef.current = true;
        isVoiceSessionActiveRef.current = true;
        recognition.start();
      } else {
        recognitionSupportedRef.current = false;
        isVoiceSessionActiveRef.current = true;
      }

      setIsRecording(true);
    } catch (err) {
      console.error("Mic access failed:", err);
      isVoiceSessionActiveRef.current = false;
      speechRecognitionRef.current = null;
      cleanupRecordingResources();
      setError(getMicrophoneErrorMessage(err));
    }
  }, [cleanupRecordingResources, syncTranscriptState]);

  const stopRecording = useCallback(() => {
    isVoiceSessionActiveRef.current = false;
    speechRecognitionRef.current?.stop();
    speechRecognitionRef.current = null;

    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      mediaRecorderRef.current.stop();
    } else {
      cleanupRecordingResources();
    }
    setIsRecording(false);
  }, [cleanupRecordingResources]);

  const transcribeAudio = async (blob: Blob, options?: { fallbackText?: string }) => {
    setIsTranscribing(true);
    setError(null);
    try {
      const formData = new FormData();
      const extension = recorderSupportRef.current?.extension || "webm";
      formData.append("audio", blob, `commentary.${extension}`);
      formData.append("sessionId", sessionId);

      const res = await fetch("/api/commentary/transcribe", {
        method: "POST",
        body: formData,
      });

      if (!res.ok) {
        const err = await res.json();
        const error = new Error(err.error || "Transcription failed") as Error & {
          code?: string;
        };
        if (typeof err?.code === "string") {
          error.code = err.code;
        }
        throw error;
      }

      const data = await res.json();
      const cleanedText =
        finalizeCommentaryText(data.text || data.rawText || "") ||
        finalizeCommentaryText(options?.fallbackText || "");

      setTranscribedText(cleanedText);
    } catch (err) {
      console.error("Transcription failed:", err);
      const fallbackText = finalizeCommentaryText(options?.fallbackText || transcribedText);
      if (fallbackText) {
        setTranscribedText(fallbackText);
        setNotice("Using the live browser transcript. Final grammar cleanup will still run when you post.");
        setError(null);
        return;
      }
      setError(err instanceof Error ? err.message : "Transcription failed");
    } finally {
      setIsTranscribing(false);
    }
  };

  const postEntry = async () => {
    const text = finalizeCommentaryText(transcribedText);
    if (!text) return;

    setIsPosting(true);
    setError(null);
    setNotice(null);
    try {
      setTranscribedText(text);
      const res = await fetch(`/api/commentary/${sessionId}/entries`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text,
          overText: overText.trim() || null,
          source: inputMode,
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to post entry");
      }

      const data = await res.json();
      onEntryPosted(data.entry);
      setTranscribedText("");
      setOverText("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to post entry");
    } finally {
      setIsPosting(false);
    }
  };

  const updateSessionStatus = async (newStatus: string) => {
    try {
      const res = await fetch(`/api/commentary/${sessionId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus }),
      });

      if (res.ok) {
        onStatusChange(newStatus);
      }
    } catch (err) {
      console.error("Status update failed:", err);
    }
  };

  const isLive = sessionStatus === "live";
  const supportsRealtimeTranscription = recognitionSupportedRef.current;

  return (
    <div className="bg-cg-dark-2 border border-gray-800 rounded-2xl overflow-hidden">
      {/* Header with session controls */}
      <div className="px-5 py-4 bg-gradient-to-r from-cg-dark-3 to-cg-dark-2 border-b border-gray-800">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className={`w-3 h-3 rounded-full ${isLive ? "bg-red-500 animate-pulse" : sessionStatus === "paused" ? "bg-yellow-500" : "bg-gray-500"}`} />
            <h3 className="text-white font-bold text-lg">Commentary Controls</h3>
            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${isLive ? "bg-red-500/20 text-red-400" : sessionStatus === "paused" ? "bg-yellow-500/20 text-yellow-400" : "bg-gray-500/20 text-gray-400"}`}>
              {sessionStatus.toUpperCase()}
            </span>
          </div>
          <div className="flex items-center gap-2">
            {isLive && (
              <button
                onClick={() => updateSessionStatus("paused")}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-yellow-500/10 text-yellow-400 hover:bg-yellow-500/20 transition text-sm font-medium"
              >
                <Pause size={14} /> Pause
              </button>
            )}
            {sessionStatus === "paused" && (
              <button
                onClick={() => updateSessionStatus("live")}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-cg-green/10 text-cg-green hover:bg-cg-green/20 transition text-sm font-medium"
              >
                <Play size={14} /> Resume
              </button>
            )}
            {sessionStatus !== "ended" && (
              <button
                onClick={() => updateSessionStatus("ended")}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-500/10 text-red-400 hover:bg-red-500/20 transition text-sm font-medium"
              >
                <StopCircle size={14} /> End
              </button>
            )}
          </div>
        </div>
      </div>

      {sessionStatus === "ended" ? (
        <div className="px-5 py-10 text-center">
          <p className="text-gray-400 text-lg">This commentary session has ended.</p>
        </div>
      ) : (
        <div className="p-5 space-y-4">
          {/* Input mode toggle */}
          <div className="flex items-center gap-2">
            <button
              onClick={() => setInputMode("voice")}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition ${inputMode === "voice" ? "bg-cg-green/20 text-cg-green border border-cg-green/30" : "bg-gray-800 text-gray-400 border border-gray-700 hover:text-white"}`}
            >
              <Volume2 size={14} /> Voice
            </button>
            <button
              onClick={() => setInputMode("typed")}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition ${inputMode === "typed" ? "bg-cg-green/20 text-cg-green border border-cg-green/30" : "bg-gray-800 text-gray-400 border border-gray-700 hover:text-white"}`}
            >
              <Keyboard size={14} /> Type
            </button>
          </div>

          {/* Voice recording section */}
          {inputMode === "voice" && (
            <div className="flex flex-col items-center gap-4 py-4">
              {/* Waveform visualiser ring */}
              <div className="relative">
                <div
                  className={`w-24 h-24 rounded-full flex items-center justify-center transition-all duration-200 ${
                    isRecording
                      ? "bg-red-500/20 border-2 border-red-500"
                      : "bg-gray-800 border-2 border-gray-700 hover:border-cg-green/50"
                  }`}
                  style={
                    isRecording
                      ? { boxShadow: `0 0 ${20 + audioLevel * 40}px ${audioLevel * 20}px rgba(239, 68, 68, ${0.2 + audioLevel * 0.3})` }
                      : undefined
                  }
                >
                  <button
                    onClick={isRecording ? stopRecording : startRecording}
                    disabled={isTranscribing || !isLive}
                    className="w-16 h-16 rounded-full flex items-center justify-center transition-all disabled:opacity-50"
                  >
                    {isRecording ? (
                      <MicOff size={28} className="text-red-400" />
                    ) : (
                      <Mic size={28} className="text-cg-green" />
                    )}
                  </button>
                </div>
                {/* Audio level bars */}
                {isRecording && (
                  <div className="absolute -bottom-2 left-1/2 -translate-x-1/2 flex gap-0.5">
                    {[...Array(5)].map((_, i) => (
                      <div
                        key={i}
                        className="w-1 bg-red-400 rounded-full transition-all duration-100"
                        style={{
                          height: `${8 + audioLevel * (12 + i * 6)}px`,
                          opacity: audioLevel > i * 0.15 ? 1 : 0.3,
                        }}
                      />
                    ))}
                  </div>
                )}
              </div>
              <p className="text-gray-400 text-sm">
                {isRecording
                  ? supportsRealtimeTranscription
                    ? "Listening live... words will appear as you speak"
                    : "Recording... Click to stop"
                  : isTranscribing
                  ? "Transcribing your audio..."
                  : "Click the mic to start live voice transcription"}
              </p>
              {isTranscribing && (
                <Loader2 size={20} className="text-cg-green animate-spin" />
              )}
            </div>
          )}

          {/* Over reference input */}
          <div className="flex items-center gap-3">
            <label className="text-gray-400 text-sm font-medium whitespace-nowrap">
              Over:
            </label>
            <input
              type="text"
              placeholder="e.g. 12.3"
              value={overText}
              onChange={(e) => setOverText(e.target.value)}
              className="w-24 px-3 py-2 rounded-lg bg-gray-800 border border-gray-700 text-white text-sm focus:border-cg-green focus:outline-none"
            />
          </div>

          {/* Transcribed / typed text area */}
          <div className="relative">
            <textarea
              placeholder={inputMode === "voice"
                ? "Your commentary will appear here live as you speak. You can edit before posting..."
                : "Type your commentary here..."}
              value={transcribedText}
              onChange={(e) => setTranscribedText(e.target.value)}
              rows={3}
              className="w-full px-4 py-3 rounded-xl bg-gray-800 border border-gray-700 text-white placeholder-gray-500 resize-none focus:border-cg-green focus:outline-none transition"
            />
            <p className="mt-2 text-xs text-gray-500">
              Commentary is cleaned for grammar, capitalization, and punctuation before posting.
            </p>
          </div>

          {notice && (
            <div className="px-3 py-2 rounded-lg bg-cg-green/10 border border-cg-green/20 text-cg-green text-sm">
              {notice}
            </div>
          )}

          {/* Error message */}
          {error && (
            <div className="px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-sm">
              {error}
            </div>
          )}

          {/* Post button */}
          <button
            onClick={postEntry}
            disabled={!transcribedText.trim() || isPosting || isRecording || isTranscribing || !isLive}
            className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-cg-green text-black font-bold text-sm hover:bg-cg-green-dark transition disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isPosting ? (
              <Loader2 size={16} className="animate-spin" />
            ) : (
              <Send size={16} />
            )}
            {isPosting ? "Posting..." : "Post Commentary"}
          </button>
        </div>
      )}
    </div>
  );
}

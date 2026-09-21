import { useCallback, useEffect, useRef, useState } from 'react';
import * as sdk from 'microsoft-cognitiveservices-speech-sdk';

interface Props {
  /** Live partial transcript while the key is held. */
  onPartial: (text: string) => void;
  /** Final recognised text (appended to the composer). */
  onFinal: (text: string) => void;
  /** Identifiers from the workspace that bias recognition (file/class names). */
  phrases?: string[];
  disabled?: boolean;
}

/**
 * Push-to-talk: hold the button (or Ctrl+Shift+Space) to dictate; release to stop.
 * Speech tokens come from the gateway, so the Speech key never reaches the client.
 */
export function VoiceButton({ onPartial, onFinal, phrases = [], disabled }: Props) {
  const [active, setActive] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const recognizer = useRef<sdk.SpeechRecognizer | null>(null);

  const stop = useCallback(() => {
    const r = recognizer.current;
    recognizer.current = null;
    setActive(false);
    if (!r) return;
    r.stopContinuousRecognitionAsync(
      () => r.close(),
      () => r.close(),
    );
  }, []);

  const start = useCallback(async () => {
    if (recognizer.current || disabled) return;
    setError(null);
    try {
      const { token, region } = await window.airiel.speech.token();
      const config = sdk.SpeechConfig.fromAuthorizationToken(token, region);
      config.speechRecognitionLanguage = 'en-AU';
      const audio = sdk.AudioConfig.fromDefaultMicrophoneInput();
      const r = new sdk.SpeechRecognizer(config, audio);
      if (phrases.length) {
        const grammar = sdk.PhraseListGrammar.fromRecognizer(r);
        for (const p of phrases.slice(0, 500)) grammar.addPhrase(p);
      }
      r.recognizing = (_s, e) => onPartial(e.result.text);
      r.recognized = (_s, e) => {
        if (e.result.reason === sdk.ResultReason.RecognizedSpeech && e.result.text) onFinal(e.result.text);
      };
      r.canceled = (_s, e) => {
        if (e.reason === sdk.CancellationReason.Error) setError(e.errorDetails);
        stop();
      };
      recognizer.current = r;
      setActive(true);
      r.startContinuousRecognitionAsync(undefined, (err) => {
        setError(String(err));
        stop();
      });
    } catch (err) {
      setError((err as Error).message);
    }
  }, [disabled, phrases, onPartial, onFinal, stop]);

  // Global hotkey: Ctrl+Shift+Space (hold).
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && e.code === 'Space' && !e.repeat) {
        e.preventDefault();
        void start();
      }
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === 'Space' && recognizer.current) stop();
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
    };
  }, [start, stop]);

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        title="Hold to talk (Ctrl+Shift+Space)"
        disabled={disabled}
        onMouseDown={() => void start()}
        onMouseUp={stop}
        onMouseLeave={() => active && stop()}
        className={`rounded-full border px-3 py-2 transition ${
          active ? 'animate-pulse border-[var(--danger)] bg-[var(--danger)]/20' : 'border-[var(--border)] hover:bg-[var(--panel-2)]'
        } disabled:opacity-40`}
      >
        🎙️
      </button>
      {error && <span className="text-xs text-[var(--danger)]">{error}</span>}
    </div>
  );
}

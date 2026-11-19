import { useCallback, useEffect, useRef, useState } from 'react';
import { pickVoice, sentences } from './speech';

// Speaks with the device's built-in voices (Web Speech API). A script is spoken one
// sentence at a time: pausing remembers the sentence and stops, resuming starts from it
// (the browsers' own pause is unreliable, and Chrome cuts off long utterances). Nothing
// leaves the device.

export type ReadAloudState = 'idle' | 'speaking' | 'paused';

const synthesis = (): SpeechSynthesis | null =>
  typeof window !== 'undefined' && 'speechSynthesis' in window && 'SpeechSynthesisUtterance' in window ? window.speechSynthesis : null;

/** How long to wait for the device to list its voices before treating it as having none. */
const VOICE_WAIT_MS = 1500;

export function useReadAloud() {
  const synth = synthesis();
  // Unknown until the voices load; true once one is found for some language.
  const [available, setAvailable] = useState(false);
  const [state, setState] = useState<ReadAloudState>('idle');
  const [failed, setFailed] = useState(false);
  const voice = useRef<SpeechSynthesisVoice | null>(null);
  const queue = useRef<string[]>([]);
  const at = useRef(0);
  // Each speak, pause or stop starts a new generation; events from older ones are ignored.
  // (A plain object: it is bumped on purpose when the hook goes away.)
  const [generation] = useState(() => ({ value: 0 }));

  useEffect(() => {
    if (!synth) return;
    let done = false;
    const load = () => {
      const voices = synth.getVoices();
      if (!voices.length) return;
      done = true;
      voice.current = pickVoice(voices, navigator.language) ?? voices.find(v => v.default) ?? voices[0];
      setAvailable(true);
    };
    load();
    synth.addEventListener?.('voiceschanged', load);
    const t = window.setTimeout(() => { if (!done) load(); }, VOICE_WAIT_MS);
    return () => {
      window.clearTimeout(t);
      synth.removeEventListener?.('voiceschanged', load);
      generation.value++;
      synth.cancel();
    };
  }, [synth, generation]);

  const speakFrom = useCallback((index: number) => {
    if (!synth) return;
    const gen = ++generation.value;
    const lines = queue.current;
    if (index >= lines.length) { setState('idle'); return; }
    const run = () => {
      if (gen !== generation.value) return;
      lines.slice(index).forEach((line, offset) => {
        const u = new SpeechSynthesisUtterance(line);
        if (voice.current) { u.voice = voice.current; u.lang = voice.current.lang; }
        u.rate = 0.95;
        u.onstart = () => { if (gen === generation.value) { at.current = index + offset; setState('speaking'); } };
        u.onend = () => { if (gen === generation.value && index + offset === lines.length - 1) setState('idle'); };
        u.onerror = e => {
          if (gen !== generation.value || e.error === 'interrupted' || e.error === 'canceled') return;
          generation.value++;
          synth.cancel();
          setState('idle');
          setFailed(true);
        };
        synth.speak(u);
      });
      setState('speaking');
    };
    // iOS speaks only from inside the tap that asked, so start at once when nothing is
    // playing; after a cancel, Chrome needs a moment before it speaks again.
    if (synth.speaking || synth.pending) { synth.cancel(); window.setTimeout(run, 60); } else run();
  }, [synth, generation]);

  /** Speaks a script from the start, replacing whatever was being said. */
  const speak = useCallback((script: string) => {
    queue.current = sentences(script);
    at.current = 0;
    setFailed(false);
    speakFrom(0);
  }, [speakFrom]);

  const pause = useCallback(() => {
    if (!synth) return;
    generation.value++;
    synth.cancel();
    setState('paused');
  }, [synth, generation]);

  const resume = useCallback(() => speakFrom(at.current), [speakFrom]);

  const stop = useCallback(() => {
    if (!synth) return;
    generation.value++;
    synth.cancel();
    at.current = 0;
    setState('idle');
  }, [synth, generation]);

  return { available: !!synth && available, state, failed, speak, pause, resume, stop };
}

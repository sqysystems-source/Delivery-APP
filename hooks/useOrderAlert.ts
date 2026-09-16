"use client";
/* ==========================================================================
 *  Buka Delivery — hooks/useOrderAlert.ts
 *
 *  Ηχητικός συναγερμός νέας παραγγελίας.
 *
 *  ── ΓΙΑΤΙ ΔΕΝ ΧΡΗΣΙΜΟΠΟΙΩ ΑΡΧΕΙΟ MP3 ───────────────────────────────────
 *  Ο ήχος παράγεται ζωντανά με το Web Audio API. Τρεις λόγοι:
 *   1. Δεν χρειάζεται να ανεβάσεις binary αρχείο — δουλεύεις από GitHub web UI
 *   2. Μηδέν καθυστέρηση φόρτωσης: ο συναγερμός χτυπά ακαριαία
 *   3. Δεν σπάει ποτέ από 404 ή από cache που δεν ανανεώθηκε
 *
 *  ── AUTOPLAY POLICY ────────────────────────────────────────────────────
 *  Όλοι οι σύγχρονοι browsers ξεκινούν το AudioContext σε κατάσταση
 *  "suspended" και αρνούνται να παίξουν ήχο πριν από πραγματική
 *  αλληλεπίδραση του χρήστη. Γι' αυτό υπάρχει το `enable()`: ΠΡΕΠΕΙ να
 *  κληθεί μέσα από handler κλικ (το κουμπί «Έναρξη βάρδιας»). Από εκεί και
 *  πέρα ο συναγερμός χτυπά ελεύθερα όσο η καρτέλα ζει.
 *
 *  Αν το tablet κλειδώσει ή η καρτέλα πάει στο παρασκήνιο, ο browser μπορεί
 *  να ξανα-suspend-άρει το context· το `start()` το επαναφέρει μόνο του.
 * ========================================================================== */

import { useCallback, useEffect, useRef, useState } from "react";

/* --------------------------------------------------------------------------
 *  Ρυθμίσεις ήχου — άλλαξέ τες αν ο χώρος είναι πιο θορυβώδης
 * -------------------------------------------------------------------------- */

const ALERT = {
  /** Ένταση 0–1. Στο 0.9 ακούγεται καθαρά μέσα από θόρυβο κουζίνας */
  volume: 0.9,
  /** Συχνότητες των δύο εναλλασσόμενων τόνων (Hz) */
  highHz: 1180,
  lowHz: 780,
  /** Διάρκεια κάθε μπιπ (δευτερόλεπτα) */
  beepDuration: 0.16,
  /** Κενό ανάμεσα στα μπιπ */
  beepGap: 0.1,
  /** Πόσα μπιπ ανά κύκλο */
  beepsPerCycle: 4,
  /** Κάθε πόσο επαναλαμβάνεται ο κύκλος (ms) */
  cycleIntervalMs: 2000,
} as const;

type AudioContextConstructor = new () => AudioContext;

function getAudioContextConstructor(): AudioContextConstructor | null {
  if (typeof window === "undefined") return null;

  const candidate =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: AudioContextConstructor })
      .webkitAudioContext;

  return candidate ?? null;
}

export type UseOrderAlert = {
  /** true αφού ο χρήστης ξεκλειδώσει τον ήχο με κλικ */
  ready: boolean;
  /** true όσο ο συναγερμός χτυπά */
  playing: boolean;
  muted: boolean;
  /** Υποστηρίζεται καθόλου ήχος σε αυτόν τον browser; */
  supported: boolean;
  /** ΠΡΕΠΕΙ να κληθεί από handler κλικ */
  enable: () => Promise<boolean>;
  start: () => void;
  stop: () => void;
  toggleMute: () => void;
  /** Δοκιμαστικό μπιπ, για να ελέγξει το προσωπικό την ένταση */
  test: () => void;
};

export function useOrderAlert(): UseOrderAlert {
  const contextRef = useRef<AudioContext | null>(null);
  const masterGainRef = useRef<GainNode | null>(null);
  const intervalRef = useRef<number | null>(null);

  const [ready, setReady] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(false);

  const supported = getAudioContextConstructor() !== null;

  /* Το mute διαβάζεται μέσα σε setInterval — το κρατάμε και σε ref */
  const mutedRef = useRef(false);
  useEffect(() => {
    mutedRef.current = muted;
    if (masterGainRef.current && contextRef.current) {
      masterGainRef.current.gain.setValueAtTime(
        muted ? 0 : ALERT.volume,
        contextRef.current.currentTime,
      );
    }
  }, [muted]);

  /* ------------------------ Παραγωγή ενός κύκλου ------------------------ */
  const playCycle = useCallback(() => {
    const context = contextRef.current;
    const masterGain = masterGainRef.current;
    if (!context || !masterGain || mutedRef.current) return;

    const startAt = context.currentTime + 0.02;

    for (let index = 0; index < ALERT.beepsPerCycle; index += 1) {
      const offset = index * (ALERT.beepDuration + ALERT.beepGap);
      const beepStart = startAt + offset;
      const beepEnd = beepStart + ALERT.beepDuration;

      const oscillator = context.createOscillator();
      const envelope = context.createGain();

      /* Τετραγωνικό κύμα: πιο «διαπεραστικό» από ημίτονο, ακούγεται μέσα
       * από θόρυβο. Το τρίγωνο θα ήταν πιο ήπιο — δοκίμασε "triangle" αν
       * ενοχλεί το προσωπικό. */
      oscillator.type = "square";
      oscillator.frequency.setValueAtTime(
        index % 2 === 0 ? ALERT.highHz : ALERT.lowHz,
        beepStart,
      );

      /* Ομαλή άνοδος/κάθοδος: χωρίς αυτήν ακούγεται «κλικ» στα άκρα */
      envelope.gain.setValueAtTime(0, beepStart);
      envelope.gain.linearRampToValueAtTime(1, beepStart + 0.012);
      envelope.gain.setValueAtTime(1, beepEnd - 0.03);
      envelope.gain.linearRampToValueAtTime(0, beepEnd);

      oscillator.connect(envelope);
      envelope.connect(masterGain);

      oscillator.start(beepStart);
      oscillator.stop(beepEnd + 0.02);
    }
  }, []);

  /* ------------------------- Ξεκλείδωμα (κλικ) -------------------------- */
  const enable = useCallback(async (): Promise<boolean> => {
    const AudioContextCtor = getAudioContextConstructor();
    if (!AudioContextCtor) return false;

    try {
      if (!contextRef.current) {
        const context = new AudioContextCtor();
        const masterGain = context.createGain();
        masterGain.gain.setValueAtTime(ALERT.volume, context.currentTime);
        masterGain.connect(context.destination);

        contextRef.current = context;
        masterGainRef.current = masterGain;
      }

      if (contextRef.current.state === "suspended") {
        await contextRef.current.resume();
      }

      setReady(true);
      return true;
    } catch (caught) {
      console.error("[alert] Αποτυχία ενεργοποίησης ήχου:", caught);
      return false;
    }
  }, []);

  /* ------------------------------ Έναρξη -------------------------------- */
  const start = useCallback(() => {
    if (!contextRef.current || intervalRef.current !== null) return;

    /* Ο browser μπορεί να έχει ξανα-suspend-άρει το context στο παρασκήνιο */
    if (contextRef.current.state === "suspended") {
      void contextRef.current.resume();
    }

    setPlaying(true);
    playCycle();
    intervalRef.current = window.setInterval(playCycle, ALERT.cycleIntervalMs);
  }, [playCycle]);

  /* ------------------------------ Παύση --------------------------------- */
  const stop = useCallback(() => {
    if (intervalRef.current !== null) {
      window.clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    setPlaying(false);
  }, []);

  const toggleMute = useCallback(() => setMuted((value) => !value), []);

  const test = useCallback(() => {
    if (!contextRef.current) return;
    if (contextRef.current.state === "suspended") {
      void contextRef.current.resume();
    }
    playCycle();
  }, [playCycle]);

  /* --------------------------- Καθαρισμός ------------------------------- */
  useEffect(() => {
    return () => {
      if (intervalRef.current !== null) {
        window.clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      void contextRef.current?.close();
      contextRef.current = null;
      masterGainRef.current = null;
    };
  }, []);

  return { ready, playing, muted, supported, enable, start, stop, toggleMute, test };
}

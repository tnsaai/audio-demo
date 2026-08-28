"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Mic, Pause, Play, Square } from "lucide-react";

import { cn } from "@/lib/cn";
import { Button } from "./ui";

/** RMS below this is treated as no acoustic signal at all. */
const SILENCE_FLOOR = 0.008;
const BAR_WIDTH = 3;
const BAR_GAP = 2;

/**
 * Recording UI with a live waveform.
 *
 * The waveform is not decoration — while recording you otherwise cannot tell
 * whether the mic is picking anything up, and a silent take only reveals itself
 * after a round trip to the box.
 *
 * The render loop is started from an effect, not from the click handler: the
 * canvas only exists once `recording` is true, so anything reading
 * `canvasRef.current` synchronously after `setRecording(true)` sees null and
 * never schedules a frame.
 */
export function WaveformRecorder({
  onDone,
  disabled,
}: {
  onDone: (blob: Blob, filename: string, url: string) => void;
  disabled?: boolean;
}) {
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [silent, setSilent] = useState(false);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const contextRef = useRef<AudioContext | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const levelsRef = useRef<number[]>([]);
  // Highest level across the whole take. A natural pause between words must not
  // read as a dead microphone, so the warning keys off this rather than the
  // instantaneous level.
  const loudestRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const teardown = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
    recorderRef.current?.stream.getTracks().forEach((track) => track.stop());
    sourceRef.current?.disconnect();
    sourceRef.current = null;
    analyserRef.current = null;
    const context = contextRef.current;
    contextRef.current = null;
    if (context && context.state !== "closed") void context.close().catch(() => {});
  }, []);

  useEffect(() => teardown, [teardown]);

  /** Sample the analyser and repaint. Runs only while `recording` is true. */
  useEffect(() => {
    if (!recording) return;
    let frame = 0;
    let cancelled = false;

    const tick = () => {
      if (cancelled) return;
      const analyser = analyserRef.current;
      const element = canvasRef.current;

      if (analyser && element) {
        const width = element.clientWidth;
        const height = element.clientHeight;
        if (width > 0 && height > 0) {
          const dpr = window.devicePixelRatio || 1;
          const targetWidth = Math.round(width * dpr);
          const targetHeight = Math.round(height * dpr);
          if (element.width !== targetWidth || element.height !== targetHeight) {
            element.width = targetWidth;
            element.height = targetHeight;
          }
          const context = element.getContext("2d");
          if (context) {
            context.setTransform(dpr, 0, 0, dpr, 0, 0);

            const buffer = new Uint8Array(analyser.fftSize);
            analyser.getByteTimeDomainData(buffer);
            let sum = 0;
            for (const value of buffer) {
              const centred = (value - 128) / 128;
              sum += centred * centred;
            }
            const rms = Math.sqrt(sum / buffer.length);
            if (rms > loudestRef.current) loudestRef.current = rms;

            const capacity = Math.max(1, Math.floor(width / (BAR_WIDTH + BAR_GAP)));
            levelsRef.current.push(rms);
            while (levelsRef.current.length > capacity) levelsRef.current.shift();

            context.clearRect(0, 0, width, height);
            context.fillStyle = "rgba(139,147,167,0.25)";
            context.fillRect(0, height / 2 - 0.5, width, 1);

            levelsRef.current.forEach((level, index) => {
              const scaled = Math.min(1, level * 3.2);
              const barHeight = Math.max(2, scaled * (height - 6));
              const x = index * (BAR_WIDTH + BAR_GAP);
              const y = (height - barHeight) / 2;
              context.fillStyle = scaled > 0.9 ? "#f87171" : "#4ade80";
              context.globalAlpha = 0.5 + scaled * 0.5;
              context.beginPath();
              context.roundRect(x, y, BAR_WIDTH, barHeight, 1.5);
              context.fill();
            });
            context.globalAlpha = 1;
          }
        }
      }
      frame = requestAnimationFrame(tick);
    };

    frame = requestAnimationFrame(tick);
    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
    };
  }, [recording]);

  /**
   * Silence check, polled rather than driven from the render loop — setting
   * React state at 60 fps would re-render the whole panel on every frame.
   */
  useEffect(() => {
    if (!recording) {
      setSilent(false);
      return;
    }
    const started = Date.now();
    const poll = setInterval(() => {
      // Give the mic a moment to spin up before accusing it of being dead.
      if (Date.now() - started < 1500) return;
      setSilent(loudestRef.current < SILENCE_FLOOR);
    }, 400);
    return () => clearInterval(poll);
  }, [recording]);

  const start = async () => {
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: false },
      });
    } catch {
      alert("Microphone permission denied.");
      return;
    }

    chunksRef.current = [];
    levelsRef.current = [];
    loudestRef.current = 0;

    const context = new AudioContext();
    // Chrome hands back a suspended context when it is created outside a user
    // gesture; without this the analyser reports a flat 128 forever.
    if (context.state === "suspended") await context.resume().catch(() => {});
    const analyser = context.createAnalyser();
    analyser.fftSize = 1024;
    analyser.smoothingTimeConstant = 0.6;
    const source = context.createMediaStreamSource(stream);
    source.connect(analyser);

    contextRef.current = context;
    analyserRef.current = analyser;
    sourceRef.current = source;

    const media = new MediaRecorder(stream);
    media.ondataavailable = (event) => {
      if (event.data.size) chunksRef.current.push(event.data);
    };
    media.onstop = () => {
      stream.getTracks().forEach((track) => track.stop());
      const blob = new Blob(chunksRef.current, { type: media.mimeType || "audio/webm" });
      onDone(blob, `recording-${Date.now()}.webm`, URL.createObjectURL(blob));
    };
    media.start();
    recorderRef.current = media;

    setSeconds(0);
    setSilent(false);
    setRecording(true);
    timerRef.current = setInterval(() => setSeconds((value) => value + 1), 1000);
  };

  const stop = () => {
    recorderRef.current?.stop();
    recorderRef.current = null;
    setRecording(false);
    teardown();
  };

  return (
    <div className="flex items-center gap-3">
      <Button
        disabled={disabled}
        variant={recording ? "primary" : "default"}
        onClick={recording ? stop : start}
      >
        {recording ? <Square className="h-3.5 w-3.5" /> : <Mic className="h-3.5 w-3.5" />}
        {recording ? "Stop" : "Record"}
      </Button>

      {recording ? (
        <div className="flex flex-1 items-center gap-3 rounded-xl border border-[var(--color-line)] bg-[var(--color-raised)] px-3 py-1.5">
          <span className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-[var(--color-bad)]" />
          <canvas ref={canvasRef} className="h-9 min-w-0 flex-1" />
          <span className="shrink-0 font-mono text-[12px] tabular-nums text-[var(--color-body)]">
            {String(Math.floor(seconds / 60)).padStart(2, "0")}:
            {String(seconds % 60).padStart(2, "0")}
          </span>
          {silent ? (
            <span
              className="shrink-0 text-[11px] text-[var(--color-warn)]"
              title="No audio has reached the recorder since it started — check the input device."
            >
              no signal
            </span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/**
 * Static waveform for a captured or uploaded clip, with a playhead.
 * Decoding happens once; peaks are downsampled to the bar count.
 */
export function WaveformPlayer({ url, className }: { url: string; className?: string }) {
  const [peaks, setPeaks] = useState<number[] | null>(null);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);
  const audio = useRef<HTMLAudioElement>(null);

  useEffect(() => {
    let cancelled = false;
    setPeaks(null);
    void (async () => {
      try {
        const response = await fetch(url);
        const bytes = await response.arrayBuffer();
        const context = new AudioContext();
        const buffer = await context.decodeAudioData(bytes);
        await context.close();
        if (cancelled) return;

        const channel = buffer.getChannelData(0);
        const bars = 180;
        const size = Math.floor(channel.length / bars);
        const out: number[] = [];
        for (let i = 0; i < bars; i++) {
          let max = 0;
          for (let j = 0; j < size; j++) {
            const value = Math.abs(channel[i * size + j] ?? 0);
            if (value > max) max = value;
          }
          out.push(max);
        }
        const ceiling = Math.max(...out) || 1;
        setPeaks(out.map((value) => value / ceiling));
        setDuration(buffer.duration);
      } catch {
        if (!cancelled) setPeaks([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [url]);

  const toggle = () => {
    const element = audio.current;
    if (!element) return;
    if (playing) element.pause();
    else void element.play();
  };

  const seek = (event: React.MouseEvent<HTMLDivElement>) => {
    const element = audio.current;
    if (!element || !duration) return;
    const box = event.currentTarget.getBoundingClientRect();
    element.currentTime = ((event.clientX - box.left) / box.width) * duration;
  };

  return (
    <div className={cn("flex items-center gap-3", className)}>
      <audio
        ref={audio}
        src={url}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => {
          setPlaying(false);
          setProgress(0);
        }}
        onTimeUpdate={(event) => {
          const element = event.currentTarget;
          if (element.duration) setProgress(element.currentTime / element.duration);
        }}
        onLoadedMetadata={(event) => {
          const value = event.currentTarget.duration;
          if (Number.isFinite(value)) setDuration(value);
        }}
        className="hidden"
      />

      <button
        type="button"
        onClick={toggle}
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-[var(--color-line)] bg-[var(--color-raised)] text-[var(--color-body)] transition-colors hover:border-[var(--color-muted)]/60"
      >
        {playing ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
      </button>

      <div onClick={seek} className="flex h-9 min-w-0 flex-1 cursor-pointer items-center gap-px">
        {peaks === null ? (
          <div className="h-1 w-full animate-pulse rounded bg-[var(--color-raised)]" />
        ) : peaks.length === 0 ? (
          <div className="h-1 w-full rounded bg-[var(--color-line)]" />
        ) : (
          peaks.map((value, index) => {
            // (index + 1) so nothing reads as played while the head is at zero.
            const played = (index + 1) / peaks.length <= progress;
            return (
              <div
                key={index}
                className="flex-1 rounded-[1px] transition-colors"
                style={{
                  height: `${Math.max(6, value * 100)}%`,
                  background: played ? "var(--color-v2)" : "var(--color-line)",
                  opacity: played ? 0.9 : 1,
                }}
              />
            );
          })
        )}
      </div>

      {duration ? (
        <span className="shrink-0 font-mono text-[11px] tabular-nums text-[var(--color-muted)]">
          {duration.toFixed(1)}s
        </span>
      ) : null}
    </div>
  );
}

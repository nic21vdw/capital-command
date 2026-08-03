import { REALTIME_SAMPLE_RATE, bufferFromBase64, encodeCaptureChunk, pcm16ToFloat, peakLevel } from "@/lib/voice/pcm";

const WORKLET_SOURCE = `
class CapitalCaptureProcessor extends AudioWorkletProcessor {
  process(inputs) {
    const input = inputs[0];
    if (input && input[0] && input[0].length) this.port.postMessage(new Float32Array(input[0]));
    return true;
  }
}
registerProcessor('capital-capture', CapitalCaptureProcessor);
`;

let workletUrl: string | null = null;

function captureWorkletUrl(): string {
  if (!workletUrl) workletUrl = URL.createObjectURL(new Blob([WORKLET_SOURCE], { type: "text/javascript" }));
  return workletUrl;
}

function audioContextConstructor(): typeof AudioContext {
  const scope = window as typeof window & { webkitAudioContext?: typeof AudioContext };
  const Ctor = window.AudioContext ?? scope.webkitAudioContext;
  if (!Ctor) throw new Error("This browser has no Web Audio support.");
  return Ctor;
}

export type MicCapture = { stop: () => void };

export async function startMicCapture(handlers: {
  onChunk: (base64: string) => void;
  onLevel?: (level: number) => void;
}): Promise<MicCapture> {
  if (!navigator.mediaDevices?.getUserMedia) throw new Error("This browser has no microphone access.");
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true }
  });

  const Ctor = audioContextConstructor();
  let context: AudioContext;
  try {
    context = new Ctor({ sampleRate: REALTIME_SAMPLE_RATE });
  } catch {
    context = new Ctor();
  }
  if (context.state === "suspended") await context.resume();

  const source = context.createMediaStreamSource(stream);
  let stopped = false;

  const handle = (samples: Float32Array) => {
    if (stopped) return;
    handlers.onLevel?.(peakLevel(samples));
    handlers.onChunk(encodeCaptureChunk(samples, context.sampleRate));
  };

  let node: AudioNode | null = null;
  if (context.audioWorklet) {
    try {
      await context.audioWorklet.addModule(captureWorkletUrl());
      const worklet = new AudioWorkletNode(context, "capital-capture");
      worklet.port.onmessage = (event) => handle(event.data as Float32Array);
      node = worklet;
    } catch {
      node = null;
    }
  }
  if (!node) {
    const processor = context.createScriptProcessor(2048, 1, 1);
    processor.onaudioprocess = (event) => handle(event.inputBuffer.getChannelData(0));
    node = processor;
  }

  source.connect(node);
  const sink = context.createGain();
  sink.gain.value = 0;
  node.connect(sink);
  sink.connect(context.destination);

  return {
    stop() {
      if (stopped) return;
      stopped = true;
      try {
        source.disconnect();
        node?.disconnect();
        sink.disconnect();
      } catch {
        /* already torn down */
      }
      stream.getTracks().forEach((track) => track.stop());
      void context.close().catch(() => {});
    }
  };
}

export type PlaybackQueue = {
  resume: () => Promise<void>;
  push: (base64: string) => Promise<void>;
  cancel: () => void;
  close: () => void;
};

export function createPlaybackQueue(handlers: { onSpeakingChange?: (speaking: boolean) => void } = {}): PlaybackQueue {
  const context = new (audioContextConstructor())({ sampleRate: REALTIME_SAMPLE_RATE });
  let cursor = 0;
  let live = new Set<AudioBufferSourceNode>();
  let speaking = false;
  let unlock = Promise.resolve();

  const setSpeaking = (next: boolean) => {
    if (next === speaking) return;
    speaking = next;
    handlers.onSpeakingChange?.(next);
  };

  const ensureRunning = () => {
    if (context.state !== "suspended") return unlock;
    unlock = context.resume().catch(() => {});
    return unlock;
  };

  return {
    resume: ensureRunning,
    async push(base64: string) {
      const floats = pcm16ToFloat(bufferFromBase64(base64));
      if (!floats.length) return;
      await ensureRunning();
      if (context.state === "closed") return;
      const buffer = context.createBuffer(1, floats.length, REALTIME_SAMPLE_RATE);
      buffer.copyToChannel(new Float32Array(floats), 0);
      const source = context.createBufferSource();
      source.buffer = buffer;
      source.connect(context.destination);
      const now = context.currentTime;
      if (cursor < now) cursor = now + 0.03;
      source.start(cursor);
      cursor += buffer.duration;
      live.add(source);
      setSpeaking(true);
      source.onended = () => {
        live.delete(source);
        if (!live.size) setSpeaking(false);
      };
    },
    cancel() {
      live.forEach((source) => {
        try {
          source.stop();
        } catch {
          /* already finished */
        }
      });
      live = new Set();
      cursor = 0;
      setSpeaking(false);
    },
    close() {
      this.cancel();
      void context.close().catch(() => {});
    }
  };
}

export function speak(text: string, lang: "bn" | "en"): void {
  if (typeof window === "undefined" || !window.speechSynthesis) return;
  window.speechSynthesis.cancel();
  const utter = new SpeechSynthesisUtterance(text);
  utter.lang = lang === "bn" ? "bn-BD" : "en-US";
  utter.rate = 0.95;
  window.speechSynthesis.speak(utter);
}

type RecogCtor = new () => SpeechRecognitionLike;

type SpeechRecognitionLike = {
  lang: string;
  interimResults: boolean;
  maxAlternatives: number;
  continuous: boolean;
  onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string; confidence: number }>> }) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
};

function recognitionCtor(): RecogCtor | null {
  const w = window as unknown as { SpeechRecognition?: RecogCtor; webkitSpeechRecognition?: RecogCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export function canUseSpeech(): boolean {
  return typeof window !== "undefined" && recognitionCtor() !== null;
}

export function listenOnce(lang: "bn" | "en"): Promise<{ transcript: string; confidence: number }> {
  const Ctor = recognitionCtor();
  if (!Ctor) {
    return Promise.reject(new Error("speech-unavailable"));
  }
  return new Promise((resolve, reject) => {
    const rec = new Ctor();
    rec.lang = lang === "bn" ? "bn-BD" : "en-US";
    rec.interimResults = false;
    rec.maxAlternatives = 1;
    rec.continuous = false;
    rec.onresult = (event) => {
      const first = event.results[0]?.[0];
      if (!first) {
        reject(new Error("empty"));
        return;
      }
      resolve({ transcript: first.transcript, confidence: first.confidence || 0.9 });
    };
    rec.onerror = (event) => reject(new Error(event.error));
    rec.onend = () => undefined;
    rec.start();
  });
}

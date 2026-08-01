// Thin wrappers over the browser Web Speech API (no backend needed).

export function sttSupported(): boolean {
  return typeof window !== "undefined" && !!((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition);
}

export function ttsSupported(): boolean {
  return typeof window !== "undefined" && !!window.speechSynthesis;
}

export function createRecognition(): any | null {
  if (!sttSupported()) return null;
  const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
  const r = new SR();
  r.lang = "en-US";
  r.interimResults = false;
  r.maxAlternatives = 1;
  return r;
}

export function speak(text: string) {
  if (!ttsSupported()) return;
  window.speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text.slice(0, 4000));
  u.rate = 1.03;
  window.speechSynthesis.speak(u);
}

export function stopSpeaking() {
  if (ttsSupported()) window.speechSynthesis.cancel();
}

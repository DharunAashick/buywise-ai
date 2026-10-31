import { ChangeDetectionStrategy, Component, effect, ElementRef, inject, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { BuyWiseStore } from '../core/buywise.store';
import { renderChat, speakable } from '../core/format';

// Minimal Web Speech API typings (not in lib.dom for all browsers).
type Recognition = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: (e: { results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void;
  onend: () => void;
  onerror: () => void;
  start(): void;
  stop(): void;
};

const SUGGESTIONS = ['I want to buy a new phone', 'I need a laptop for college', 'I want a PS5', 'I need noise-cancelling headphones'];

@Component({
  selector: 'app-chat-panel',
  imports: [FormsModule],
  templateUrl: './chat-panel.html',
  styleUrl: './chat-panel.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ChatPanel {
  protected store = inject(BuyWiseStore);
  protected draft = signal('');
  protected listening = signal(false);
  protected speakReplies = signal(false);
  protected readonly suggestions = SUGGESTIONS;
  protected readonly render = renderChat;
  protected readonly voiceSupported = typeof window !== 'undefined' && ('SpeechRecognition' in window || 'webkitSpeechRecognition' in window);

  private scroller = viewChild<ElementRef<HTMLElement>>('scroller');
  private recognition?: Recognition;

  constructor() {
    // Keep the newest message in view.
    effect(() => {
      this.store.session();
      this.store.streamingText();
      this.store.activity();
      queueMicrotask(() => {
        const el = this.scroller()?.nativeElement;
        if (el) el.scrollTop = el.scrollHeight;
      });
    });
    // Read replies aloud when voice mode is on.
    effect(() => {
      const reply = this.store.lastReply();
      if (!reply || !this.speakReplies() || !('speechSynthesis' in window)) return;
      window.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(speakable(reply.text));
      u.rate = 1.05;
      window.speechSynthesis.speak(u);
    });
  }

  send(text = this.draft()) {
    if (!text.trim() || this.store.busy()) return;
    this.draft.set('');
    this.store.send(text.trim());
  }

  onKey(e: KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      this.send();
    }
  }

  toggleVoice() {
    if (this.listening()) {
      this.recognition?.stop();
      return;
    }
    const Ctor = (window as any).SpeechRecognition ?? (window as any).webkitSpeechRecognition;
    if (!Ctor) return;
    const rec: Recognition = new Ctor();
    rec.lang = 'en-US';
    rec.interimResults = true;
    rec.continuous = false;
    let finalText = '';
    rec.onresult = (e) => {
      let interim = '';
      for (let i = 0; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) finalText += r[0].transcript;
        else interim += r[0].transcript;
      }
      this.draft.set((finalText + interim).trim());
    };
    rec.onend = () => {
      this.listening.set(false);
      if (finalText.trim()) {
        this.speakReplies.set(true); // a spoken question gets a spoken answer
        this.send(finalText);
      }
    };
    rec.onerror = () => this.listening.set(false);
    this.recognition = rec;
    this.listening.set(true);
    rec.start();
  }
}

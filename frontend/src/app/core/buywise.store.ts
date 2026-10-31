import { computed, inject, Injectable, signal } from '@angular/core';
import { ApiError, ApiService } from './api.service';
import type { AppConfig, PurchasePlan, SessionView, SolutionOption } from './models';
import { modelLabel, type Fx } from './format';

export interface ActivityItem {
  id: string;
  label: string;
  state: 'running' | 'ok' | 'error';
  error?: string;
}

const SESSION_KEY = 'buywise.sessionId';

function readSessionId(): string | null {
  try {
    return localStorage.getItem(SESSION_KEY);
  } catch {
    return null;
  }
}
function writeSessionId(id: string | null) {
  try {
    if (id) localStorage.setItem(SESSION_KEY, id);
    else localStorage.removeItem(SESSION_KEY);
  } catch {
    /* storage unavailable - session just won't survive reload */
  }
}

const ACTIVE_STATUSES = new Set(['DRAFT', 'FINAL_REVIEW', 'LOCKED', 'AUTHORIZATION_FAILED', 'AUTHORIZED', 'PAYMENT_PENDING']);

@Injectable({ providedIn: 'root' })
export class BuyWiseStore {
  private api = inject(ApiService);

  readonly config = signal<AppConfig | null>(null);
  readonly session = signal<SessionView | null>(null);
  readonly busy = signal(false);
  readonly streamingText = signal('');
  readonly pendingUserText = signal<string | null>(null);
  readonly activity = signal<ActivityItem[]>([]);
  readonly error = signal<string | null>(null);
  readonly selectedOptionId = signal<string | null>(null);
  readonly checkoutOpen = signal(false);
  readonly plan = signal<PurchasePlan | null>(null);
  /** Fires with the final assistant text of each turn (used for voice read-out). */
  readonly lastReply = signal<{ text: string; at: number } | null>(null);

  /** User's own currency when they gave their salary in one (amounts display in it; PayPal charges USD). */
  readonly fx = computed<Fx | null>(() => {
    const s = this.session()?.profile.statedIncome;
    return s && s.currency !== 'USD' ? { currency: s.currency, usdRate: s.usdRate } : null;
  });

  /** Human-readable name of the model answering, e.g. "Gemini 3.5 Flash-Lite". */
  readonly modelName = computed(() => modelLabel(this.config()?.model));

  /** What the agent is doing right now, for the live status line. */
  readonly phase = computed<{ kind: 'thinking' | 'tool' | 'typing'; label: string } | null>(() => {
    if (!this.busy()) return null;
    const running = [...this.activity()].reverse().find((a) => a.state === 'running');
    if (running) return { kind: 'tool', label: running.label };
    if (this.streamingText()) return { kind: 'typing', label: 'Typing' };
    return { kind: 'thinking', label: this.activity().length ? 'Analysing results' : 'Thinking' };
  });

  readonly options = computed(() => this.session()?.options ?? []);
  readonly recommended = computed<SolutionOption | undefined>(() => {
    const s = this.session();
    return s?.options.find((o) => o.id === s.recommendedOptionId) ?? s?.options[0];
  });
  readonly selected = computed<SolutionOption | undefined>(
    () => this.options().find((o) => o.id === this.selectedOptionId()) ?? this.recommended(),
  );

  private refreshTimer?: ReturnType<typeof setTimeout>;

  async init() {
    try {
      this.config.set(await this.api.config());
    } catch {
      this.error.set('Cannot reach the BuyWise backend. Is it running on port 3000?');
      return;
    }
    const existing = readSessionId();
    if (existing) {
      try {
        this.applySession(await this.api.getSession(existing));
        return;
      } catch {
        writeSessionId(null);
      }
    }
    await this.newSession();
  }

  async newSession() {
    const s = await this.api.createSession();
    writeSessionId(s.id);
    this.plan.set(null);
    this.checkoutOpen.set(false);
    this.selectedOptionId.set(null);
    this.activity.set([]);
    this.applySession(s);
  }

  private applySession(s: SessionView) {
    this.session.set(s);
    const active = [...s.plans].reverse().find((p) => ACTIVE_STATUSES.has(p.status));
    const current = this.plan();
    if (active && (!current || current.id !== active.id || active.updatedAt > current.updatedAt)) {
      const isNew = !current || current.id !== active.id;
      this.plan.set(active);
      if (isNew && active.status === 'DRAFT') this.checkoutOpen.set(true);
    }
  }

  async refresh() {
    const s = this.session();
    if (!s) return;
    this.applySession(await this.api.getSession(s.id));
  }

  private scheduleRefresh() {
    clearTimeout(this.refreshTimer);
    this.refreshTimer = setTimeout(() => this.refresh().catch(() => {}), 150);
  }

  async send(text: string) {
    const s = this.session();
    if (!s || this.busy() || !text.trim()) return;
    this.busy.set(true);
    this.error.set(null);
    this.pendingUserText.set(text);
    this.streamingText.set('');
    this.activity.set([]);
    let reply = '';
    try {
      await this.api.chat(s.id, text, (e) => {
        switch (e.type) {
          case 'text':
            reply += e.delta;
            this.streamingText.update((t) => t + e.delta);
            break;
          case 'tool_start':
            // Text before a tool call is a progress note; start a fresh bubble after the tool runs.
            this.activity.update((a) => [...a, { id: e.id, label: e.label, state: 'running' }]);
            break;
          case 'tool_end':
            this.activity.update((a) => a.map((x) => (x.id === e.id ? { ...x, state: e.ok ? 'ok' : 'error', error: e.error } : x)));
            break;
          case 'state':
            this.scheduleRefresh();
            break;
          case 'error':
            this.error.set(e.message);
            break;
        }
      });
      await this.refresh();
    } catch (err) {
      this.error.set(err instanceof Error ? err.message : 'Chat failed');
    } finally {
      this.pendingUserText.set(null);
      this.streamingText.set('');
      this.busy.set(false);
      if (reply.trim()) this.lastReply.set({ text: reply, at: Date.now() });
    }
  }

  async toggleComponent(optionId: string, componentId: string, included: boolean) {
    const s = this.session();
    if (!s) return;
    try {
      this.applySession(await this.api.toggleComponent(s.id, optionId, componentId, included));
    } catch (err) {
      this.error.set(err instanceof ApiError ? err.message : 'Could not update option');
    }
  }

  async startCheckout(option: SolutionOption) {
    const s = this.session();
    if (!s) return;
    try {
      const plan = await this.api.createPlan(
        s.id,
        option.id,
        option.components.filter((c) => c.included).map((c) => c.id),
      );
      this.plan.set(plan);
      this.checkoutOpen.set(true);
    } catch (err) {
      this.error.set(err instanceof ApiError ? err.message : 'Could not create plan');
    }
  }

  setPlan(plan: PurchasePlan) {
    this.plan.set(plan);
  }
}

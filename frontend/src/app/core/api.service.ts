import { Injectable } from '@angular/core';
import type { AgentEvent, ApiErrorBody, AppConfig, AppUser, PurchasePlan, SessionView } from './models';

export class ApiError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status: number,
    readonly body?: ApiErrorBody['error'],
  ) {
    super(message);
  }
}

const BASE = '/api';

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', ...(init.headers ?? {}) },
  });
  if (!res.ok) {
    let body: ApiErrorBody | undefined;
    try {
      body = await res.json();
    } catch {
      /* non-JSON error */
    }
    throw new ApiError(body?.error.message ?? `Request failed (${res.status})`, body?.error.code ?? 'HTTP_ERROR', res.status, body?.error);
  }
  return (await res.json()) as T;
}

const post = <T>(path: string, body?: unknown) => call<T>(path, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) });

@Injectable({ providedIn: 'root' })
export class ApiService {
  config = () => call<AppConfig>('/config');
  me = () => call<{ user: AppUser | null; paypalLoginAvailable: boolean }>('/auth/me');
  logout = () => post<{ ok: boolean }>('/auth/logout');
  setPin = (pin: string, currentPin?: string) => post<{ user: AppUser }>('/auth/pin', { pin, currentPin });
  createSession = () => post<SessionView>('/sessions');
  getSession = (id: string) => call<SessionView>(`/sessions/${id}`);
  toggleComponent = (sessionId: string, optionId: string, componentId: string, included: boolean) =>
    post<SessionView>(`/sessions/${sessionId}/options/${optionId}/components`, { componentId, included });

  // Only ids are sent - the server computes every amount.
  createPlan = (sessionId: string, optionId: string, includeComponentIds?: string[]) =>
    post<PurchasePlan>('/plans', { sessionId, optionId, includeComponentIds });
  getPlan = (id: string) => call<PurchasePlan>(`/plans/${id}`);
  lockPlan = (id: string) => post<PurchasePlan>(`/plans/${id}/lock`);
  authorizePlan = (id: string, lockHash: string, pin: string) => post<PurchasePlan>(`/plans/${id}/authorize`, { lockHash, pin });
  capturePlan = (id: string, orderId: string) => post<PurchasePlan>(`/plans/${id}/capture`, { orderId });
  cancelPlan = (id: string) => post<PurchasePlan>(`/plans/${id}/cancel`);

  /** Streams one agent turn as server-sent events. */
  async chat(sessionId: string, message: string, onEvent: (e: AgentEvent) => void, signal?: AbortSignal): Promise<void> {
    const res = await fetch(`${BASE}/sessions/${sessionId}/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'text/event-stream' },
      body: JSON.stringify({ message }),
      signal,
    });
    if (!res.ok || !res.body) {
      let msg = `Chat failed (${res.status})`;
      try {
        msg = ((await res.json()) as ApiErrorBody).error.message;
      } catch {
        /* ignore */
      }
      onEvent({ type: 'error', message: msg });
      return;
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let idx: number;
      while ((idx = buffer.indexOf('\n\n')) >= 0) {
        const chunk = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        const data = chunk
          .split('\n')
          .filter((l) => l.startsWith('data: '))
          .map((l) => l.slice(6))
          .join('\n');
        if (data) onEvent(JSON.parse(data) as AgentEvent);
      }
    }
  }
}

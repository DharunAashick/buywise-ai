import { Pipe, PipeTransform } from '@angular/core';
import type { Impact } from './models';

const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
const usd0 = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

/** The user's own currency (from their stated salary) and USD per unit of it. */
export interface Fx {
  currency: string;
  usdRate: number;
}

const LOCALE_FOR: Record<string, string> = { INR: 'en-IN', EUR: 'de-DE', GBP: 'en-GB', JPY: 'ja-JP' };
const localFormatters = new Map<string, Intl.NumberFormat>();

/**
 * Formats USD cents. With `fx`, shows the amount in the user's own currency instead (whole units,
 * since it's a conversion); PayPal still charges the exact USD amount.
 */
export function money(cents: number | undefined | null, whole = false, fx?: Fx | null): string {
  if (cents === undefined || cents === null) return '-';
  if (fx && fx.currency !== 'USD') {
    let f = localFormatters.get(fx.currency);
    if (!f) {
      f = new Intl.NumberFormat(LOCALE_FOR[fx.currency] ?? 'en-US', { style: 'currency', currency: fx.currency, maximumFractionDigits: 0 });
      localFormatters.set(fx.currency, f);
    }
    return f.format(cents / 100 / fx.usdRate);
  }
  return (whole ? usd0 : usd).format(cents / 100);
}

@Pipe({ name: 'money' })
export class MoneyPipe implements PipeTransform {
  transform(cents: number | undefined | null, whole = false, fx?: Fx | null): string {
    return money(cents, whole, fx);
  }
}

/** "gemini-3.5-flash-lite" -> "Gemini 3.5 Flash-Lite", "claude-opus-5-5" -> "Claude Opus 5.5". */
export function modelLabel(model: string | undefined): string {
  if (!model) return 'AI';
  const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
  if (model.startsWith('gemini-')) {
    const rest = model.slice(7).replace(/-preview.*$/, '');
    const m = /^(\d+(?:\.\d+)?)-(.+)$/.exec(rest);
    if (!m) return `Gemini ${rest}`;
    return `Gemini ${m[1]} ${m[2].split('-').map(cap).join('-')}`;
  }
  if (model.startsWith('claude-')) {
    const parts = model.slice(7).split('-');
    const family = cap(parts[0]);
    const version = parts.slice(1).filter((p) => /^\d+$/.test(p)).join('.');
    return `Claude ${family}${version ? ' ' + version : ''}`;
  }
  return model;
}

export const IMPACT_LABEL: Record<Impact, string> = {
  LOW: 'Low impact',
  MODERATE: 'Moderate impact',
  HIGH: 'High impact',
  VERY_HIGH: 'Very high impact',
  UNKNOWN: 'Not assessed',
};

function escapeHtml(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Tiny, safe markdown subset for chat bubbles: **bold**, bullet lists, paragraphs. */
export function renderChat(text: string): string {
  const lines = escapeHtml(text.trim()).split('\n');
  const out: string[] = [];
  let list = false;
  for (const raw of lines) {
    const line = raw
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/(^|[^*\w])\*(?!\s)([^*\n]+?)\*(?!\w)/g, '$1<em>$2</em>');
    const bullet = /^\s*(?:[-*•]|\d+\.)\s+(.*)$/.exec(line);
    if (bullet) {
      if (!list) {
        out.push('<ul>');
        list = true;
      }
      out.push(`<li>${bullet[1]}</li>`);
      continue;
    }
    if (list) {
      out.push('</ul>');
      list = false;
    }
    if (line.trim()) out.push(`<p>${line.replace(/^#+\s*/, '')}</p>`);
  }
  if (list) out.push('</ul>');
  return out.join('');
}

/** Plain text for speech synthesis. */
export function speakable(text: string): string {
  return text
    .replace(/\*\*/g, '')
    .replace(/^#+\s*/gm, '')
    .replace(/^\s*[-*•]\s+/gm, '')
    .replace(/\s+/g, ' ')
    .trim();
}

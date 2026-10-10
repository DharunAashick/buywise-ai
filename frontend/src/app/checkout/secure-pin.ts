import { ChangeDetectionStrategy, Component, HostListener, input, output, signal } from '@angular/core';

/**
 * Isolated PIN entry. The PIN lives only in this component's local state until submit, is emitted
 * once to the authorization call, and is wiped immediately. It never touches the chat, the store,
 * storage, logs or the AI pipeline.
 */
@Component({
  selector: 'app-secure-pin',
  template: `
    <div class="pin" role="group" aria-label="Enter your BuyWise PIN">
      <div class="dots" aria-live="polite" [attr.aria-label]="digits().length + ' of ' + length() + ' digits entered'">
        @for (i of slots; track i) {
          <span [class.filled]="i < digits().length" [class.shake]="shake()"></span>
        }
      </div>
      @if (message()) {
        <div class="msg">{{ message() }}</div>
      }
      <div class="pad">
        @for (k of keys; track k) {
          @if (k === 'del') {
            <button type="button" class="key fn" (click)="del()" [disabled]="disabled()" aria-label="Delete">⌫</button>
          } @else if (k === 'ok') {
            <button type="button" class="key ok" (click)="submit()" [disabled]="disabled() || digits().length !== length()" aria-label="Authorize">✓</button>
          } @else {
            <button type="button" class="key" (click)="press(k)" [disabled]="disabled()">{{ k }}</button>
          }
        }
      </div>
    </div>
  `,
  styles: `
    .pin { display:flex; flex-direction:column; align-items:center; gap:14px; }
    .dots { display:flex; gap:14px; }
    .dots span { width:14px; height:14px; border-radius:50%; border:2px solid var(--line-strong); transition: background .12s, transform .12s; }
    .dots span.filled { background: var(--grad); border-color: transparent; transform: scale(1.1); }
    .dots span.shake { animation: shake .35s; }
    .msg { color: var(--coral); font-size: 13px; }
    .pad { display:grid; grid-template-columns: repeat(3, 64px); gap:10px; }
    .key { height:56px; border-radius:16px; border:1px solid var(--line-strong); background: var(--surface-2); font-size:20px; font-weight:600; font-family: var(--font-display); }
    .key:hover:not(:disabled) { border-color: var(--accent); background: var(--surface-3); }
    .key.fn { color: var(--text-2); }
    .key.ok { background: var(--grad); border-color: transparent; color: #fff; }
    @keyframes shake { 25% { transform: translateX(-4px) } 75% { transform: translateX(4px) } }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SecurePin {
  length = input(4);
  disabled = input(false);
  message = input<string | null>(null);
  authorize = output<string>();

  protected digits = signal('');
  protected shake = signal(false);
  protected readonly keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'del', '0', 'ok'];
  protected get slots() {
    return Array.from({ length: this.length() }, (_, i) => i);
  }

  @HostListener('document:keydown', ['$event'])
  onKey(e: KeyboardEvent) {
    if (this.disabled()) return;
    if (/^\d$/.test(e.key)) this.press(e.key);
    else if (e.key === 'Backspace') this.del();
    else if (e.key === 'Enter') this.submit();
  }

  press(k: string) {
    if (this.digits().length < this.length()) this.digits.update((d) => d + k);
  }

  del() {
    this.digits.update((d) => d.slice(0, -1));
  }

  submit() {
    const pin = this.digits();
    if (pin.length !== this.length()) return;
    this.digits.set('');
    this.authorize.emit(pin);
  }

  /** Called by the parent after a failed attempt. */
  reject() {
    this.digits.set('');
    this.shake.set(true);
    setTimeout(() => this.shake.set(false), 400);
  }
}

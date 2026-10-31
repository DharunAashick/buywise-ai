import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { BuyWiseStore } from '../core/buywise.store';
import { SecurePin } from '../checkout/secure-pin';

/** First-login step: the user creates their own 4-digit PIN (entered twice). */
@Component({
  selector: 'app-pin-setup',
  imports: [SecurePin],
  template: `
    <div class="backdrop"></div>
    <div class="modal card" role="dialog" aria-modal="true" aria-labelledby="pin-title">
      <div class="eyebrow">Welcome, {{ store.user()?.name }}</div>
      <h2 id="pin-title">{{ first() ? 'Confirm your PIN' : 'Create your BuyWise PIN' }}</h2>
      <p>
        {{ first() ? 'Enter the same 4 digits again.' : 'You will enter this PIN to approve each purchase. It is stored only as a secure hash and never shared with the AI.' }}
      </p>
      <app-secure-pin [disabled]="saving()" [message]="error()" (authorize)="onPin($event)" />
    </div>
  `,
  styles: `
    .backdrop { position: fixed; inset: 0; background: rgba(3,5,10,.7); backdrop-filter: blur(4px); z-index: 60; }
    .modal { position: fixed; z-index: 61; left: 50%; top: 50%; transform: translate(-50%, -50%); width: min(400px, calc(100vw - 32px)); padding: 24px 22px; text-align: center; display: flex; flex-direction: column; gap: 10px; max-height: calc(100vh - 32px); overflow-y: auto; }
    h2 { margin: 0; font-family: var(--font-display); font-size: 20px; }
    p { margin: 0 0 6px; color: var(--text-2); font-size: 13px; }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PinSetup {
  protected store = inject(BuyWiseStore);
  protected first = signal<string | null>(null);
  protected error = signal<string | null>(null);
  protected saving = signal(false);

  async onPin(pin: string) {
    this.error.set(null);
    const first = this.first();
    if (!first) {
      this.first.set(pin);
      return;
    }
    if (first !== pin) {
      this.first.set(null);
      this.error.set("PINs didn't match - start again.");
      return;
    }
    this.saving.set(true);
    try {
      await this.store.setPin(pin);
    } catch {
      this.first.set(null);
      this.error.set('Could not save your PIN. Please try again.');
    } finally {
      this.saving.set(false);
    }
  }
}

import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { BuyWiseStore } from '../core/buywise.store';

@Component({
  selector: 'app-welcome',
  template: `
    <section class="welcome">
      <div class="card box">
        <div class="eyebrow">Your AI shopping agent</div>
        <h1>Buy smarter, <em>pay with PayPal</em>.</h1>
        <p class="lead">
          Tell BuyWise what you want to buy. It compares the best options, shows what each really costs over the first year, checks it
          against your salary - and once you approve, PayPal handles the payment.
        </p>

        @if (store.paypalLoginAvailable()) {
          <ul class="perks">
            <li><span>1</span>Sign in with PayPal - no new password to create</li>
            <li><span>2</span>We use your PayPal name and country, so you only tell us your salary</li>
            <li><span>3</span>You set a private PIN that approves every purchase - the AI never sees it</li>
          </ul>
        } @else {
          <ul class="perks">
            <li><span>1</span>Say what you want to buy - the AI asks your country and salary</li>
            <li><span>2</span>Compare options, true first-year cost and salary fit, in your currency</li>
            <li><span>3</span>Lock the exact purchase, approve with a PIN the AI never sees, pay with PayPal</li>
          </ul>
        }

        @if (store.notice()) {
          <div class="notice">{{ store.notice() }}</div>
        }

        @if (store.paypalLoginAvailable()) {
          <button class="paypal" (click)="store.signInWithPayPal()">
            <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
              <path fill="#003087" d="M7.1 21.3H3.6a.5.5 0 0 1-.5-.6L5.9 3a.8.8 0 0 1 .8-.7h6.7c2.3 0 4 .5 4.9 1.6.9 1 1.1 2.4.7 4.2-.6 3.2-2.8 4.9-6.3 4.9H9.6a.8.8 0 0 0-.8.7l-1 6.9a.8.8 0 0 1-.7.7Z" />
              <path fill="#0070e0" d="M19.4 8c-.7 3.6-3.2 5.4-7.1 5.4h-1.3a.8.8 0 0 0-.8.7l-.9 5.7-.3 1.6a.5.5 0 0 0 .5.6h2.9a.7.7 0 0 0 .7-.6l.6-3.8a.7.7 0 0 1 .7-.6h.5c3 0 5.2-1.2 5.9-4.7.3-1.5.2-2.6-.6-3.4l-.8-.9Z" />
            </svg>
            Continue with PayPal
          </button>
          <button class="btn ghost guest" (click)="store.continueAsGuest()">Try as guest</button>
          <p class="fine">Guests use the demo PIN from the README. Sandbox only - no real money moves.</p>
        } @else {
          <button class="btn primary guest" (click)="store.continueAsGuest()">Get started</button>
          <p class="fine">Sandbox demo: approve purchases with PIN <b>2468</b> and pay with a PayPal sandbox buyer account - no real money moves.</p>
        }
      </div>
    </section>
  `,
  styles: `
    .welcome { min-height: calc(100vh - 70px); display: grid; place-items: center; padding: 24px 16px; }
    .box { width: min(520px, 100%); padding: 28px 26px; display: flex; flex-direction: column; gap: 14px; }
    h1 { font-family: var(--font-display); font-size: clamp(26px, 4vw, 34px); letter-spacing: -0.02em; line-height: 1.1; margin: 0; }
    h1 em { font-style: normal; background: var(--grad); -webkit-background-clip: text; background-clip: text; color: transparent; }
    .lead { color: var(--text-2); margin: 0; }
    .perks { list-style: none; margin: 4px 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
    .perks li { display: flex; gap: 10px; align-items: flex-start; color: var(--text-2); font-size: 13px; }
    .perks span { flex: none; width: 20px; height: 20px; border-radius: 50%; display: grid; place-items: center; background: var(--surface-3); font-size: 11px; font-weight: 700; color: var(--text); }
    .paypal { display: flex; align-items: center; justify-content: center; gap: 10px; border: none; border-radius: 999px; padding: 13px 18px; background: #ffc439; color: #111; font-weight: 700; font-size: 15px; }
    .paypal:hover:not(:disabled) { filter: brightness(0.96); }
    .guest { width: 100%; }
    .notice { color: var(--amber); border: 1px solid rgba(251,191,36,.4); background: rgba(251,191,36,.07); padding: 9px 12px; border-radius: var(--radius-sm); font-size: 13px; }
    .hint, .fine { font-size: 12px; color: var(--text-3); margin: 0; text-align: center; }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Welcome {
  protected store = inject(BuyWiseStore);
}

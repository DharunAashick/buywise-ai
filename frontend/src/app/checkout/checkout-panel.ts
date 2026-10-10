import { ChangeDetectionStrategy, Component, computed, effect, ElementRef, inject, signal, viewChild } from '@angular/core';
import { DatePipe } from '@angular/common';
import { ApiError, ApiService } from '../core/api.service';
import { BuyWiseStore } from '../core/buywise.store';
import { IMPACT_LABEL, MoneyPipe } from '../core/format';
import type { PlanStatus, PurchasePlan } from '../core/models';
import { SecurePin } from './secure-pin';
import { loadPayPal } from './paypal-sdk';

type Step = 'review' | 'authorize' | 'pay' | 'done' | 'failed';

const STEP_FOR: Record<PlanStatus, Step> = {
  DRAFT: 'review',
  FINAL_REVIEW: 'review',
  LOCKED: 'authorize',
  AUTHORIZATION_FAILED: 'authorize',
  AUTHORIZED: 'pay',
  PAYMENT_PENDING: 'pay',
  PAYMENT_SUCCESS: 'done',
  PAYMENT_FAILED: 'failed',
  PAYMENT_DECLINED: 'failed',
  CANCELLED: 'failed',
  SYSTEM_ERROR: 'failed',
};

@Component({
  selector: 'app-checkout-panel',
  imports: [MoneyPipe, SecurePin, DatePipe],
  templateUrl: './checkout-panel.html',
  styleUrl: './checkout-panel.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CheckoutPanel {
  protected store = inject(BuyWiseStore);
  private api = inject(ApiService);

  protected plan = computed(() => this.store.plan()!);
  protected step = computed<Step>(() => STEP_FOR[this.plan().status]);
  protected working = signal(false);
  protected message = signal<string | null>(null);
  protected changes = signal<string[]>([]);
  protected pinMessage = signal<string | null>(null);
  protected paypalError = signal<string | null>(null);
  protected readonly impactLabel = IMPACT_LABEL;
  protected readonly steps: { key: Step; label: string }[] = [
    { key: 'review', label: 'Review' },
    { key: 'authorize', label: 'Lock & authorize' },
    { key: 'pay', label: 'PayPal' },
    { key: 'done', label: 'Done' },
  ];

  private pin = viewChild(SecurePin);
  private paypalHost = viewChild<ElementRef<HTMLElement>>('paypalHost');
  private renderedFor?: string;

  constructor() {
    // Render PayPal buttons once the server has created the order for the authorised plan.
    effect(() => {
      const host = this.paypalHost()?.nativeElement;
      const plan = this.plan();
      if (!host || plan.status !== 'PAYMENT_PENDING' || !plan.paypal?.orderId) return;
      if (this.renderedFor === plan.paypal.orderId) return;
      this.renderedFor = plan.paypal.orderId;
      this.renderButtons(host, plan);
    });
  }

  protected stepIndex(s: Step) {
    return this.steps.findIndex((x) => x.key === s);
  }

  protected close() {
    this.store.checkoutOpen.set(false);
  }

  private update(plan: PurchasePlan) {
    this.store.setPlan(plan);
  }

  async lock() {
    this.working.set(true);
    this.message.set(null);
    this.changes.set([]);
    try {
      this.update(await this.api.lockPlan(this.plan().id));
    } catch (err) {
      if (err instanceof ApiError && err.code === 'PRICE_CHANGED') {
        this.message.set('Some prices changed since this plan was built. Ask BuyWise to refresh the options, then try again.');
        this.changes.set(err.body?.changes ?? []);
      } else {
        this.message.set(err instanceof Error ? err.message : 'Could not lock the plan');
      }
    } finally {
      this.working.set(false);
    }
  }

  async authorize(pin: string) {
    const plan = this.plan();
    if (!plan.lock) return;
    this.working.set(true);
    this.pinMessage.set(null);
    try {
      this.update(await this.api.authorizePlan(plan.id, plan.lock.hash, pin));
    } catch (err) {
      this.pin()?.reject();
      if (err instanceof ApiError && (err.code === 'INVALID_PIN' || err.code === 'LOCKED_OUT')) {
        this.pinMessage.set(err.code === 'LOCKED_OUT' ? err.message : `Incorrect PIN · ${err.body?.attemptsLeft ?? 0} attempts left`);
      } else {
        this.pinMessage.set(err instanceof Error ? err.message : 'Authorization failed');
      }
      await this.reload();
    } finally {
      this.working.set(false);
    }
  }

  private async renderButtons(host: HTMLElement, plan: PurchasePlan) {
    const clientId = this.store.config()?.paypal.clientId;
    if (!clientId) {
      this.paypalError.set('PayPal client id is not configured on the server.');
      return;
    }
    try {
      const paypal = await loadPayPal(clientId, plan.pricing.currency);
      host.innerHTML = '';
      await paypal
        .Buttons({
          style: { layout: 'vertical', color: 'gold', shape: 'pill', label: 'pay', height: 45 },
          // The order was created server-side from the locked plan; the browser only references it.
          createOrder: () => plan.paypal!.orderId,
          onApprove: async (data: { orderID: string }) => {
            this.working.set(true);
            try {
              this.update(await this.api.capturePlan(plan.id, data.orderID));
            } catch (err) {
              this.paypalError.set(err instanceof Error ? err.message : 'Capture failed');
              await this.reload();
            } finally {
              this.working.set(false);
            }
          },
          onCancel: () => this.paypalError.set('PayPal window closed. Your locked plan is still waiting - approve when ready.'),
          onError: (e: unknown) => this.paypalError.set(`PayPal error: ${e instanceof Error ? e.message : String(e)}`),
        })
        .render(host);
    } catch (err) {
      this.paypalError.set(err instanceof Error ? err.message : 'PayPal failed to load');
      this.renderedFor = undefined;
    }
  }

  private async reload() {
    try {
      this.update(await this.api.getPlan(this.plan().id));
    } catch {
      /* keep current view */
    }
  }

  async cancel() {
    try {
      this.update(await this.api.cancelPlan(this.plan().id));
    } catch {
      /* already terminal */
    }
    this.close();
  }

  async startOver() {
    this.close();
    await this.store.refresh();
  }
}

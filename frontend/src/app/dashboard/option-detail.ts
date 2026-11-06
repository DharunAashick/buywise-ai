import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { BuyWiseStore } from '../core/buywise.store';
import { MoneyPipe } from '../core/format';
import type { SolutionComponent, SolutionOption } from '../core/models';

const ROLE_LABEL = { REQUIRED: 'Required', RECOMMENDED: 'Recommended', OPTIONAL: 'Optional' } as const;
const ROLE_CLASS = { REQUIRED: 'req', RECOMMENDED: 'rec', OPTIONAL: 'opt' } as const;

@Component({
  selector: 'app-option-detail',
  imports: [MoneyPipe],
  templateUrl: './option-detail.html',
  styleUrl: './option-detail.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class OptionDetail {
  option = input.required<SolutionOption>();
  isRecommended = input(false);
  protected store = inject(BuyWiseStore);
  protected readonly roleLabel = ROLE_LABEL;
  protected readonly roleClass = ROLE_CLASS;

  protected segments = computed(() => {
    const c = this.option().cost;
    const parts = [
      { key: 'Product', value: c.hardware, color: '#5b8cff' },
      { key: 'Accessories', value: c.accessories, color: '#8b5cf6' },
      { key: 'Software & games', value: c.software, color: '#ec4899' },
      { key: '12 mo subscriptions', value: c.annualRecurring, color: '#34d399' },
    ].filter((p) => p.value > 0);
    const total = parts.reduce((a, p) => a + p.value, 0) || 1;
    return parts.map((p) => ({ ...p, pct: (p.value / total) * 100 }));
  });

  protected scoreRows = computed(() => {
    const s = this.option().score;
    if (!s) return [];
    return [
      { key: 'Cost', value: s.cost, weight: '30%' },
      { key: 'Goal fit', value: s.goalFit, weight: '30%' },
      { key: 'Budget fit', value: s.budgetFit, weight: '20%' },
      { key: 'Bundle value', value: s.bundleValue, weight: '10%' },
      { key: 'Availability', value: s.availability, weight: '10%' },
    ];
  });

  protected groups = computed(() => {
    const order: SolutionComponent['role'][] = ['REQUIRED', 'RECOMMENDED', 'OPTIONAL'];
    return order
      .map((role) => ({ role, items: this.option().components.filter((c) => c.role === role) }))
      .filter((g) => g.items.length);
  });

  toggle(c: SolutionComponent) {
    if (c.role === 'REQUIRED') return;
    this.store.toggleComponent(this.option().id, c.id, !c.included);
  }
}

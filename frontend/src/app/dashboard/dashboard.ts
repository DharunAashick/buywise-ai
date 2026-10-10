import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { BuyWiseStore } from '../core/buywise.store';
import { IMPACT_LABEL, MoneyPipe } from '../core/format';
import { ComparisonGrid } from './comparison-grid';
import { OptionDetail } from './option-detail';

@Component({
  selector: 'app-dashboard',
  imports: [ComparisonGrid, OptionDetail, MoneyPipe],
  templateUrl: './dashboard.html',
  styleUrl: './dashboard.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Dashboard {
  protected store = inject(BuyWiseStore);
  protected readonly impactLabel = IMPACT_LABEL;

  protected rec = this.store.recommended;
  protected profile = computed(() => this.store.session()?.profile);

  /** Savings of the recommended option versus the most expensive alternative, first-year basis. */
  protected spread = computed(() => {
    const opts = this.store.options();
    const r = this.rec();
    if (!r || opts.length < 2) return 0;
    const spread = Math.max(...opts.map((o) => o.cost.firstYearTotal)) - r.cost.firstYearTotal;
    // Only worth a headline tile when the gap is meaningful (at least 5% of the first-year cost).
    return spread >= r.cost.firstYearTotal * 0.05 ? spread : 0;
  });

  protected approaches = computed(() => [...new Set(this.store.options().map((o) => o.approach))]);
}

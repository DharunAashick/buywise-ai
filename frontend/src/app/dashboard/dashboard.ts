import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { BuyWiseStore } from '../core/buywise.store';
import { IMPACT_LABEL, money, MoneyPipe } from '../core/format';
import { ComparisonGrid } from './comparison-grid';
import { OptionDetail } from './option-detail';
import { CostChart } from './cost-chart';
import { ItemsGrid } from './items-grid';

@Component({
  selector: 'app-dashboard',
  imports: [ComparisonGrid, OptionDetail, CostChart, ItemsGrid, MoneyPipe],
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

  /** "India · ₹60,000/mo ≈ $708" - the user's own figure first, USD equivalent after. */
  protected profileLine = computed(() => {
    const p = this.profile();
    if (!p) return '';
    const parts: string[] = [];
    if (p.country) parts.push(p.country);
    if (p.statedIncome) {
      let own: string;
      try {
        own = new Intl.NumberFormat('en', { style: 'currency', currency: p.statedIncome.currency, maximumFractionDigits: 0 }).format(p.statedIncome.amount);
      } catch {
        own = `${p.statedIncome.amount} ${p.statedIncome.currency}`;
      }
      const usd = p.monthlyIncome !== undefined ? money(p.monthlyIncome, true) : '';
      parts.push(p.statedIncome.currency === 'USD' ? `${own}/mo` : `${own}/mo ≈ ${usd}`);
    }
    if (p.catalogCountry && p.country && p.catalogCountry === 'US' && !/united states|usa|^us$|america/i.test(p.country)) {
      parts.push('prices from US retailers');
    }
    return parts.join(' · ');
  });

  /** "You asked for X vs we recommend Y" - only when the named product didn't rank first. */
  protected askedVsPick = computed(() => {
    const pick = this.rec();
    const asked = this.store.options().find((o) => o.matchesRequest);
    if (!pick || !asked || asked.id === pick.id) return null;
    return { asked, pick, diff: asked.cost.firstYearTotal - pick.cost.firstYearTotal };
  });

  protected approaches = computed(() => [...new Set(this.store.options().map((o) => o.approach))]);
}

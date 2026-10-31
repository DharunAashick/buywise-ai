import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { AgCharts } from 'ag-charts-angular';
import type { AgChartOptions } from 'ag-charts-community';
import type { SolutionOption } from '../core/models';
import { money, type Fx } from '../core/format';

/** Stacked bars: what each option really costs over the first year, split by what you pay for. */
@Component({
  selector: 'app-cost-chart',
  imports: [AgCharts],
  template: `<ag-charts class="chart" [options]="chartOptions()" />`,
  styles: `
    :host { display: block; }
    .chart { display: block; height: 280px; }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CostChart {
  solutions = input.required<SolutionOption[]>();
  fx = input<Fx | null>(null);
  recommendedId = input<string | undefined>();

  protected readonly chartOptions = computed<AgChartOptions>(() => {
    const fx = this.fx();
    // Plot in the user's currency when known (display only; PayPal still charges USD).
    const factor = fx ? 1 / fx.usdRate : 1;
    const toUnits = (cents: number) => Math.round((cents / 100) * factor);
    const fmt = (units: number) => money(Math.round((units / factor) * 100), true, fx);

    const data = [...this.solutions()]
      .sort((a, b) => (a.rank ?? 99) - (b.rank ?? 99))
      .map((o) => ({
        name: o.id === this.recommendedId() ? `★ ${o.name}` : o.name,
        hardware: toUnits(o.cost.hardware),
        accessories: toUnits(o.cost.accessories),
        software: toUnits(o.cost.software),
        subscriptions: toUnits(o.cost.annualRecurring),
      }));

    const series = [
      { yKey: 'hardware', yName: 'Product', fill: '#5b8cff' },
      { yKey: 'accessories', yName: 'Accessories', fill: '#8b5cf6' },
      { yKey: 'software', yName: 'Games & software', fill: '#ec4899' },
      { yKey: 'subscriptions', yName: '12 months of subscriptions', fill: '#34d399' },
    ].map((s) => ({
      type: 'bar',
      direction: 'horizontal',
      xKey: 'name',
      stacked: true,
      cornerRadius: 3,
      tooltip: {
        renderer: (p: { datum: Record<string, number | string>; yKey: string; yName?: string }) => ({
          heading: String(p.datum['name']),
          data: [{ label: p.yName ?? p.yKey, value: fmt(Number(p.datum[p.yKey])) }],
        }),
      },
      ...s,
    }));

    return {
      data,
      series,
      theme: {
        baseTheme: 'ag-default-dark',
        params: { backgroundColor: 'transparent', foregroundColor: '#e8ecf7', fontFamily: 'Inter, system-ui, sans-serif', fontSize: 12 },
      },
      padding: { top: 6, right: 14, bottom: 4, left: 4 },
      legend: { position: 'bottom' },
    } as unknown as AgChartOptions;
  });
}

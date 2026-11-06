import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { AgGridAngular } from 'ag-grid-angular';
import {
  colorSchemeDarkBlue,
  themeQuartz,
  type ColDef,
  type ColGroupDef,
  type GetRowIdParams,
  type GridApi,
  type GridReadyEvent,
  type ITooltipParams,
  type RowClassParams,
  type RowClickedEvent,
} from 'ag-grid-community';
import type { ScoreBreakdown, SolutionOption } from '../core/models';
import { IMPACT_LABEL, money, type Fx } from '../core/format';

interface Row {
  id: string;
  rank: number;
  name: string;
  approach: string;
  asked: boolean;
  upfront: number;
  monthly: number;
  firstYear: number;
  vsBest: number;
  savings: number;
  impact: SolutionOption['affordability']['impact'];
  ratio?: number;
  items: number;
  score: number;
  breakdown?: ScoreBreakdown;
}

const theme = themeQuartz.withPart(colorSchemeDarkBlue).withParams({
  backgroundColor: '#121826',
  foregroundColor: '#e8ecf7',
  headerBackgroundColor: '#0d111b',
  headerTextColor: '#a3adc8',
  oddRowBackgroundColor: '#141b2b',
  rowHoverColor: 'rgba(91,140,255,0.08)',
  selectedRowBackgroundColor: 'rgba(91,140,255,0.16)',
  borderColor: 'rgba(148,163,214,0.12)',
  accentColor: '#5b8cff',
  fontFamily: 'Inter, system-ui, sans-serif',
  headerFontWeight: 600,
  fontSize: 13,
  rowHeight: 54,
  headerHeight: 36,
  wrapperBorderRadius: 14,
  spacing: 7,
});

@Component({
  selector: 'app-comparison-grid',
  imports: [AgGridAngular],
  template: `
    <div class="toolbar">
      <span class="legend"><span class="asked-tag">You asked</span> = the product you named · hover a score for its breakdown</span>
      <button class="btn ghost small" (click)="exportCsv()" title="Download this comparison as CSV">Export CSV</button>
    </div>
    <ag-grid-angular
      class="grid"
      [theme]="theme"
      [rowData]="rows()"
      [columnDefs]="columns"
      [defaultColDef]="defaultColDef"
      [getRowId]="getRowId"
      [rowClassRules]="rowClassRules"
      [animateRows]="true"
      [tooltipShowDelay]="200"
      domLayout="autoHeight"
      [suppressCellFocus]="true"
      (gridReady)="onReady($event)"
      (rowClicked)="onRowClicked($event)"
    />
  `,
  styles: `
    :host { display: block; }
    .grid { width: 100%; }
    .toolbar { display: flex; align-items: center; justify-content: space-between; gap: 10px; flex-wrap: wrap; margin-bottom: 8px; }
    .legend { font-size: 12px; color: var(--text-3); }
    .small { padding: 5px 12px; font-size: 12px; }
    .asked-tag, :host ::ng-deep .bw-asked { display: inline-block; font-size: 10px; font-weight: 700; letter-spacing: .04em; text-transform: uppercase; color: #ffc439; border: 1px solid rgba(255,196,57,.5); border-radius: 999px; padding: 1px 7px; }
    :host ::ng-deep .ag-row.bw-selected { box-shadow: inset 3px 0 0 #5b8cff; }
    :host ::ng-deep .ag-row { cursor: pointer; }
    :host ::ng-deep .ag-cell { display: flex; align-items: center; }
    :host ::ng-deep .ag-right-aligned-cell { justify-content: flex-end; }
    :host ::ng-deep .ag-header-group-cell-label { justify-content: center; color: #6d7896; font-size: 11px; letter-spacing: .08em; text-transform: uppercase; }
    :host ::ng-deep .bw-rank { display:inline-grid; place-items:center; width:24px; height:24px; line-height:1; border-radius:8px; background:#1f2940; font-weight:700; font-size:12px; }
    :host ::ng-deep .bw-rank.top { background: linear-gradient(135deg,#5b8cff,#8b5cf6); color:#fff; }
    :host ::ng-deep .bw-name { display:flex; flex-direction:column; line-height:1.25; min-width:0; }
    :host ::ng-deep .bw-name span { overflow:hidden; text-overflow:ellipsis; }
    :host ::ng-deep .bw-name small { color:#6d7896; font-size:11px; }
    :host ::ng-deep .bw-bar { display:flex; align-items:center; gap:8px; }
    :host ::ng-deep .bw-bar i { display:block; height:6px; border-radius:6px; background:linear-gradient(90deg,#5b8cff,#8b5cf6); }
    :host ::ng-deep .bw-save { color:#34d399; font-weight:600; }
    :host ::ng-deep .bw-delta { color:#a3adc8; }
    :host ::ng-deep .bw-delta.best { color:#34d399; font-weight:600; }
    :host ::ng-deep .bw-impact { display:flex; flex-direction:column; gap:2px; line-height:1.2; }
    :host ::ng-deep .bw-impact small { color:#6d7896; font-size:11px; }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ComparisonGrid {
  options = input.required<SolutionOption[]>();
  selectedId = input<string | undefined>();
  /** Show amounts in the user's own currency when set. */
  fx = input<Fx | null>(null);
  select = output<string>();

  protected readonly theme = theme;
  private api?: GridApi<Row>;

  private m(cents: number, whole = false) {
    return money(cents, whole, this.fx());
  }
  private moneyCell(v: number) {
    return `<span class="num">${this.m(v)}</span>`;
  }

  protected rows = computed<Row[]>(() => {
    const opts = this.options();
    this.fx(); // re-render cells when the display currency changes
    const best = Math.min(...opts.map((o) => o.cost.firstYearTotal));
    return opts.map((o) => ({
      id: o.id,
      rank: o.rank ?? 0,
      name: o.name,
      approach: o.approach,
      asked: Boolean(o.matchesRequest),
      upfront: o.cost.upfrontTotal,
      monthly: o.cost.monthlyRecurring,
      firstYear: o.cost.firstYearTotal,
      vsBest: o.cost.firstYearTotal - best,
      savings: o.bundle && o.bundle.savings > 0 ? o.bundle.savings : 0,
      impact: o.affordability.impact,
      ratio: o.affordability.upfrontToIncomeRatio,
      items: o.components.filter((c) => c.included).length,
      score: o.score?.total ?? 0,
      breakdown: o.score,
    }));
  });

  protected readonly defaultColDef: ColDef = { sortable: true, resizable: true, suppressMovable: true };

  protected readonly columns: (ColDef<Row> | ColGroupDef<Row>)[] = [
    {
      field: 'rank',
      headerName: '#',
      width: 62,
      sort: 'asc',
      pinned: 'left',
      cellRenderer: (p: { value: number }) => `<span class="bw-rank ${p.value === 1 ? 'top' : ''}">${p.value}</span>`,
    },
    {
      field: 'name',
      headerName: 'Option',
      flex: 2,
      minWidth: 210,
      tooltipField: 'name',
      cellRenderer: (p: { data: Row }) =>
        `<div class="bw-name"><span>${escape(p.data.name)} ${p.data.asked ? '<span class="bw-asked">You asked</span>' : ''}</span><small>${escape(p.data.approach)} · ${p.data.items} ${p.data.items === 1 ? 'item' : 'items'}</small></div>`,
    },
    {
      headerName: 'Pay today',
      children: [
        { field: 'upfront', headerName: 'Upfront', width: 118, type: 'rightAligned', cellRenderer: (p: { value: number }) => this.moneyCell(p.value) },
        {
          field: 'savings',
          headerName: 'Bundle',
          width: 98,
          type: 'rightAligned',
          headerTooltip: 'Saved by a bundle the engine found cheaper than buying the parts separately',
          cellRenderer: (p: { value: number }) => (p.value > 0 ? `<span class="bw-save num">-${this.m(p.value, true)}</span>` : '<span style="color:#6d7896">-</span>'),
        },
      ],
    },
    {
      headerName: 'Ongoing',
      children: [{ field: 'monthly', headerName: 'Monthly', width: 106, type: 'rightAligned', cellRenderer: (p: { value: number }) => this.moneyCell(p.value) }],
    },
    {
      headerName: 'First year',
      children: [
        {
          field: 'firstYear',
          headerName: 'True cost',
          width: 124,
          type: 'rightAligned',
          headerTooltip: 'Upfront + 12 months of subscriptions',
          cellRenderer: (p: { value: number }) => `<strong class="num">${this.m(p.value)}</strong>`,
        },
        {
          field: 'vsBest',
          headerName: 'vs lowest',
          width: 104,
          type: 'rightAligned',
          cellRenderer: (p: { value: number }) => (p.value === 0 ? '<span class="bw-delta best">Lowest</span>' : `<span class="bw-delta num">+${this.m(p.value, true)}</span>`),
        },
      ],
    },
    {
      headerName: 'Fit',
      children: [
        {
          field: 'impact',
          headerName: 'Salary impact',
          width: 150,
          cellRenderer: (p: { data: Row }) =>
            `<div class="bw-impact"><span class="chip ${p.data.impact}">${IMPACT_LABEL[p.data.impact]}</span>${
              p.data.ratio !== undefined ? `<small>${p.data.ratio.toFixed(2)}× monthly salary</small>` : ''
            }</div>`,
        },
        {
          field: 'score',
          headerName: 'Score',
          width: 128,
          tooltipValueGetter: (p: ITooltipParams<Row>) => {
            const b = p.data?.breakdown;
            return b
              ? `Cost ${b.cost.toFixed(1)} (30%) · Goal fit ${b.goalFit.toFixed(1)} (30%) · Budget fit ${b.budgetFit.toFixed(1)} (20%) · Bundle ${b.bundleValue.toFixed(1)} (10%) · Availability ${b.availability.toFixed(1)} (10%)`
              : '';
          },
          cellRenderer: (p: { value: number }) => `<div class="bw-bar"><i style="width:${Math.max(4, p.value * 6)}px"></i><span class="num">${p.value.toFixed(1)}</span></div>`,
        },
      ],
    },
  ];

  protected readonly getRowId = (p: GetRowIdParams<Row>) => p.data.id;

  protected readonly rowClassRules = {
    'bw-selected': (p: RowClassParams<Row>) => p.data?.id === this.selectedId(),
  };

  protected onReady(e: GridReadyEvent<Row>) {
    this.api = e.api;
  }

  protected onRowClicked(e: RowClickedEvent<Row>) {
    if (e.data) this.select.emit(e.data.id);
    e.api.redrawRows();
  }

  /** Plain-number CSV (amounts in the display currency), for people who want to keep the comparison. */
  exportCsv() {
    const fx = this.fx();
    const unit = fx?.currency ?? 'USD';
    const plain = (cents: number) => ((cents / 100) * (fx ? 1 / fx.usdRate : 1)).toFixed(fx ? 0 : 2);
    this.api?.exportDataAsCsv({
      fileName: 'buywise-comparison.csv',
      columnKeys: ['rank', 'name', 'upfront', 'savings', 'monthly', 'firstYear', 'vsBest', 'impact', 'score'],
      processHeaderCallback: (p) => {
        const h = p.column.getColDef().headerName ?? p.column.getColId();
        return ['upfront', 'savings', 'monthly', 'firstYear', 'vsBest'].includes(p.column.getColId()) ? `${h} (${unit})` : h;
      },
      processCellCallback: (p) => {
        const id = p.column.getColId();
        if (['upfront', 'savings', 'monthly', 'firstYear', 'vsBest'].includes(id)) return plain(Number(p.value ?? 0));
        if (id === 'impact') return IMPACT_LABEL[p.value as Row['impact']];
        if (id === 'name') return p.node?.data?.asked ? `${p.value} (you asked)` : String(p.value);
        return String(p.value ?? '');
      },
    });
  }
}

function escape(s: string) {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}

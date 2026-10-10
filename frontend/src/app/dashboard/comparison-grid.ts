import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { AgGridAngular } from 'ag-grid-angular';
import { colorSchemeDarkBlue, themeQuartz, type ColDef, type GetRowIdParams, type RowClassParams, type RowClickedEvent } from 'ag-grid-community';
import type { SolutionOption } from '../core/models';
import { IMPACT_LABEL, money } from '../core/format';

interface Row {
  id: string;
  rank: number;
  name: string;
  approach: string;
  upfront: number;
  monthly: number;
  firstYear: number;
  vsBest: number;
  savings: number;
  impact: SolutionOption['affordability']['impact'];
  items: number;
  score: number;
  goalFit: number;
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
  rowHeight: 52,
  headerHeight: 40,
  wrapperBorderRadius: 14,
  spacing: 7,
});

const moneyCell = (v: number) => `<span class="num">${money(v)}</span>`;

@Component({
  selector: 'app-comparison-grid',
  imports: [AgGridAngular],
  template: `
    <ag-grid-angular
      class="grid"
      [theme]="theme"
      [rowData]="rows()"
      [columnDefs]="columns"
      [defaultColDef]="defaultColDef"
      [getRowId]="getRowId"
      [rowClassRules]="rowClassRules"
      [animateRows]="true"
      domLayout="autoHeight"
      [suppressCellFocus]="true"
      (rowClicked)="onRowClicked($event)"
    />
  `,
  styles: `
    :host { display: block; }
    .grid { width: 100%; }
    :host ::ng-deep .ag-row.bw-selected { box-shadow: inset 3px 0 0 #5b8cff; }
    :host ::ng-deep .ag-row { cursor: pointer; }
    :host ::ng-deep .ag-cell { display: flex; align-items: center; }
    :host ::ng-deep .ag-right-aligned-cell { justify-content: flex-end; }
    :host ::ng-deep .bw-rank { display:inline-grid; place-items:center; width:24px; height:24px; line-height:1; border-radius:8px; background:#1f2940; font-weight:700; font-size:12px; }
    :host ::ng-deep .bw-rank.top { background: linear-gradient(135deg,#5b8cff,#8b5cf6); color:#fff; }
    :host ::ng-deep .bw-name { display:flex; flex-direction:column; line-height:1.25; }
    :host ::ng-deep .bw-name small { color:#6d7896; font-size:11px; }
    :host ::ng-deep .bw-bar { display:flex; align-items:center; gap:8px; }
    :host ::ng-deep .bw-bar i { display:block; height:6px; border-radius:6px; background:linear-gradient(90deg,#5b8cff,#8b5cf6); }
    :host ::ng-deep .bw-save { color:#34d399; font-weight:600; }
    :host ::ng-deep .bw-delta { color:#a3adc8; }
    :host ::ng-deep .bw-delta.best { color:#34d399; font-weight:600; }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ComparisonGrid {
  options = input.required<SolutionOption[]>();
  selectedId = input<string | undefined>();
  select = output<string>();

  protected readonly theme = theme;

  protected rows = computed<Row[]>(() => {
    const opts = this.options();
    const best = Math.min(...opts.map((o) => o.cost.firstYearTotal));
    return opts.map((o) => ({
      id: o.id,
      rank: o.rank ?? 0,
      name: o.name,
      approach: o.approach,
      upfront: o.cost.upfrontTotal,
      monthly: o.cost.monthlyRecurring,
      firstYear: o.cost.firstYearTotal,
      vsBest: o.cost.firstYearTotal - best,
      savings: o.bundle && o.bundle.savings > 0 ? o.bundle.savings : 0,
      impact: o.affordability.impact,
      items: o.components.filter((c) => c.included).length,
      score: o.score?.total ?? 0,
      goalFit: o.goalFit,
    }));
  });

  protected readonly defaultColDef: ColDef = { sortable: true, resizable: true, suppressMovable: true };

  protected readonly columns: ColDef<Row>[] = [
    {
      field: 'rank',
      headerName: '#',
      width: 64,
      sort: 'asc',
      cellRenderer: (p: { value: number }) => `<span class="bw-rank ${p.value === 1 ? 'top' : ''}">${p.value}</span>`,
    },
    {
      field: 'name',
      headerName: 'Solution',
      flex: 2,
      minWidth: 200,
      cellRenderer: (p: { data: Row }) => `<div class="bw-name"><span>${escape(p.data.name)}</span><small>${escape(p.data.approach)} · ${p.data.items} items</small></div>`,
    },
    { field: 'upfront', headerName: 'Upfront', width: 120, type: 'rightAligned', cellRenderer: (p: { value: number }) => moneyCell(p.value) },
    { field: 'monthly', headerName: 'Monthly', width: 110, type: 'rightAligned', cellRenderer: (p: { value: number }) => moneyCell(p.value) },
    {
      field: 'firstYear',
      headerName: 'First year',
      width: 130,
      type: 'rightAligned',
      cellRenderer: (p: { value: number }) => `<strong class="num">${money(p.value)}</strong>`,
    },
    {
      field: 'vsBest',
      headerName: 'vs lowest',
      width: 110,
      type: 'rightAligned',
      cellRenderer: (p: { value: number }) => (p.value === 0 ? '<span class="bw-delta best">Lowest</span>' : `<span class="bw-delta num">+${money(p.value, true)}</span>`),
    },
    {
      field: 'savings',
      headerName: 'Bundle',
      width: 105,
      type: 'rightAligned',
      cellRenderer: (p: { value: number }) => (p.value > 0 ? `<span class="bw-save num">-${money(p.value, true)}</span>` : '<span style="color:#6d7896">-</span>'),
    },
    {
      field: 'impact',
      headerName: 'Budget impact',
      width: 150,
      cellRenderer: (p: { value: Row['impact'] }) => `<span class="chip ${p.value}">${IMPACT_LABEL[p.value]}</span>`,
    },
    {
      field: 'score',
      headerName: 'Score',
      width: 140,
      cellRenderer: (p: { value: number }) => `<div class="bw-bar"><i style="width:${Math.max(4, p.value * 6)}px"></i><span class="num">${p.value.toFixed(1)}</span></div>`,
    },
  ];

  protected readonly getRowId = (p: GetRowIdParams<Row>) => p.data.id;

  protected readonly rowClassRules = {
    'bw-selected': (p: RowClassParams<Row>) => p.data?.id === this.selectedId(),
  };

  protected onRowClicked(e: RowClickedEvent<Row>) {
    if (e.data) this.select.emit(e.data.id);
    e.api.redrawRows();
  }
}

function escape(s: string) {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}

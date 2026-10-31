import { ChangeDetectionStrategy, Component, computed, effect, input, output, signal } from '@angular/core';
import { AgGridAngular } from 'ag-grid-angular';
import {
  colorSchemeDarkBlue,
  themeQuartz,
  type CellValueChangedEvent,
  type ColDef,
  type GridApi,
  type GridReadyEvent,
  type IRowNode,
  type RowClassParams,
} from 'ag-grid-community';
import type { SolutionOption } from '../core/models';
import { money, type Fx } from '../core/format';

interface ItemRow {
  optionId: string;
  option: string;
  rank: number;
  componentId: string;
  item: string;
  role: 'REQUIRED' | 'RECOMMENDED' | 'OPTIONAL' | 'TOTAL';
  kind: string;
  retailer: string;
  oneTime: number; // cents
  monthly: number; // cents
  firstYear: number; // cents
  included: boolean;
}

const ROLE_LABEL: Record<string, string> = { REQUIRED: 'Required', RECOMMENDED: 'Recommended', OPTIONAL: 'Optional' };
const ROLE_CLASS: Record<string, string> = { REQUIRED: 'req', RECOMMENDED: 'rec', OPTIONAL: 'opt' };
const KIND_LABEL: Record<string, string> = { HARDWARE: 'Product', ACCESSORY: 'Accessory', SOFTWARE: 'Software', SUBSCRIPTION: 'Subscription' };

const theme = themeQuartz.withPart(colorSchemeDarkBlue).withParams({
  backgroundColor: '#121826',
  foregroundColor: '#e8ecf7',
  headerBackgroundColor: '#0d111b',
  headerTextColor: '#a3adc8',
  oddRowBackgroundColor: '#141b2b',
  rowHoverColor: 'rgba(91,140,255,0.08)',
  borderColor: 'rgba(148,163,214,0.12)',
  accentColor: '#5b8cff',
  fontFamily: 'Inter, system-ui, sans-serif',
  headerFontWeight: 600,
  fontSize: 13,
  rowHeight: 44,
  headerHeight: 38,
  wrapperBorderRadius: 14,
  spacing: 6,
});

/**
 * Every item across every option, with in-grid include/exclude checkboxes (recomputed by the
 * backend cost engine), option tabs (external filter), quick search and a pinned totals row.
 */
@Component({
  selector: 'app-items-grid',
  imports: [AgGridAngular],
  template: `
    <div class="toolbar">
      <div class="tabs" role="tablist">
        <button role="tab" [class.on]="filterId() === null" (click)="filterId.set(null)">All options</button>
        @for (o of tabs(); track o.id) {
          <button role="tab" [class.on]="filterId() === o.id" (click)="filterId.set(o.id)">#{{ o.rank }} {{ o.name }}</button>
        }
      </div>
      <input class="search" type="search" placeholder="Search items…" [value]="search()" (input)="search.set($any($event.target).value)" aria-label="Search items" />
    </div>
    <ag-grid-angular
      class="grid"
      [theme]="theme"
      [rowData]="rows()"
      [columnDefs]="columns"
      [defaultColDef]="defaultColDef"
      [getRowId]="getRowId"
      [quickFilterText]="search()"
      [isExternalFilterPresent]="isExternalFilterPresent"
      [doesExternalFilterPass]="doesExternalFilterPass"
      [rowClassRules]="rowClassRules"
      [singleClickEdit]="true"
      [stopEditingWhenCellsLoseFocus]="true"
      domLayout="autoHeight"
      (gridReady)="onReady($event)"
      (cellValueChanged)="onCellValueChanged($event)"
      (filterChanged)="updateTotals()"
      (rowDataUpdated)="updateTotals()"
    />
  `,
  styles: `
    :host { display: block; }
    .toolbar { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; justify-content: space-between; margin-bottom: 10px; }
    .tabs { display: flex; flex-wrap: wrap; gap: 6px; }
    .tabs button { border: 1px solid var(--line-strong); background: var(--surface); color: var(--text-2); border-radius: 999px; padding: 5px 12px; font-size: 12px; font-weight: 600; max-width: 240px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .tabs button.on { background: rgba(91,140,255,.16); border-color: var(--accent); color: var(--text); }
    .search { background: var(--surface); border: 1px solid var(--line-strong); color: var(--text); border-radius: 999px; padding: 6px 12px; font: inherit; font-size: 12px; min-width: 180px; }
    .search:focus { outline: none; border-color: var(--accent); }
    :host ::ng-deep .ag-cell { display: flex; align-items: center; }
    :host ::ng-deep .ag-right-aligned-cell { justify-content: flex-end; }
    :host ::ng-deep .bw-off { opacity: .5; }
    :host ::ng-deep .ag-row-pinned { font-weight: 700; background: #0d111b !important; }
    :host ::ng-deep .bw-opt small { color: #6d7896; }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ItemsGrid {
  solutions = input.required<SolutionOption[]>();
  fx = input<Fx | null>(null);
  /** Option to show first (the one selected in the comparison grid). */
  focusId = input<string | undefined>();
  toggle = output<{ optionId: string; componentId: string; included: boolean }>();

  protected readonly theme = theme;
  protected filterId = signal<string | null>(null);
  protected search = signal('');
  private api?: GridApi<ItemRow>;

  constructor() {
    // Follow the option selected elsewhere in the dashboard.
    effect(() => {
      const id = this.focusId();
      if (id) this.filterId.set(id);
    });
    effect(() => {
      this.filterId();
      this.api?.onFilterChanged();
    });
  }

  protected tabs = computed(() =>
    [...this.solutions()].sort((a, b) => (a.rank ?? 99) - (b.rank ?? 99)).map((o) => ({ id: o.id, name: o.name, rank: o.rank ?? 0 })),
  );

  protected rows = computed<ItemRow[]>(() => {
    this.fx(); // re-render money cells when the display currency changes
    const out: ItemRow[] = [];
    for (const o of [...this.solutions()].sort((a, b) => (a.rank ?? 99) - (b.rank ?? 99))) {
      for (const c of o.components) {
        const oneTime = c.recurringMonthly ? 0 : c.unitPrice * c.quantity;
        const monthly = (c.recurringMonthly ?? 0) * c.quantity;
        out.push({
          optionId: o.id,
          option: o.name,
          rank: o.rank ?? 0,
          componentId: c.id,
          item: c.quantity > 1 ? `${c.quantity} × ${c.title}` : c.title,
          role: c.role,
          kind: KIND_LABEL[c.kind] ?? c.kind,
          retailer: c.retailer ?? '',
          oneTime,
          monthly,
          firstYear: oneTime + monthly * 12,
          included: c.included,
        });
      }
    }
    return out;
  });

  private m(cents: number) {
    return money(cents, false, this.fx());
  }

  protected readonly defaultColDef: ColDef<ItemRow> = { sortable: true, resizable: true, suppressMovable: true };

  protected readonly columns: ColDef<ItemRow>[] = [
    {
      field: 'included',
      headerName: 'Buy',
      width: 72,
      cellDataType: 'boolean',
      editable: (p) => p.data?.role !== 'REQUIRED' && p.data?.role !== 'TOTAL',
      headerTooltip: 'Untick to leave an item out - totals recalculate',
      cellRendererSelector: (p) => (p.node.rowPinned ? { component: () => '' } : undefined),
    },
    {
      field: 'item',
      headerName: 'Item',
      flex: 2,
      minWidth: 220,
      tooltipField: 'item',
    },
    {
      field: 'option',
      headerName: 'Option',
      flex: 1,
      minWidth: 160,
      cellRenderer: (p: { data: ItemRow; node: IRowNode }) =>
        p.node.rowPinned ? '' : `<span class="bw-opt">#${p.data.rank} <small>${escape(p.data.option)}</small></span>`,
    },
    {
      field: 'role',
      headerName: 'Need',
      width: 130,
      cellRenderer: (p: { value: string }) => (ROLE_LABEL[p.value] ? `<span class="chip ${ROLE_CLASS[p.value]}">${ROLE_LABEL[p.value]}</span>` : ''),
    },
    { field: 'kind', headerName: 'Type', width: 120 },
    { field: 'retailer', headerName: 'Retailer', width: 140 },
    {
      field: 'oneTime',
      headerName: 'One-time',
      width: 120,
      type: 'rightAligned',
      valueFormatter: (p) => (p.value ? this.m(p.value) : '-'),
    },
    {
      field: 'monthly',
      headerName: 'Monthly',
      width: 110,
      type: 'rightAligned',
      valueFormatter: (p) => (p.value ? this.m(p.value) : '-'),
    },
    {
      field: 'firstYear',
      headerName: 'First year',
      width: 125,
      type: 'rightAligned',
      sort: 'desc',
      valueFormatter: (p) => this.m(p.value ?? 0),
    },
  ];

  protected readonly getRowId = (p: { data: ItemRow }) => `${p.data.optionId}:${p.data.componentId}`;

  protected readonly rowClassRules = {
    'bw-off': (p: RowClassParams<ItemRow>) => !p.node.rowPinned && p.data?.included === false,
  };

  protected readonly isExternalFilterPresent = () => this.filterId() !== null;
  protected readonly doesExternalFilterPass = (node: IRowNode<ItemRow>) => node.data?.optionId === this.filterId();

  onReady(e: GridReadyEvent<ItemRow>) {
    this.api = e.api;
    this.updateTotals();
  }

  /** Pinned totals row: sums of the included items currently visible. */
  updateTotals() {
    if (!this.api) return;
    let oneTime = 0;
    let monthly = 0;
    let count = 0;
    this.api.forEachNodeAfterFilter((n) => {
      if (n.data?.included) {
        oneTime += n.data.oneTime;
        monthly += n.data.monthly;
        count++;
      }
    });
    const label = this.filterId() ? `Total for this option (${count} items)` : `Total across all options (${count} items)`;
    this.api.setGridOption('pinnedBottomRowData', [
      {
        optionId: '',
        option: '',
        rank: 0,
        componentId: 'total',
        item: label,
        role: 'TOTAL',
        kind: '',
        retailer: '',
        oneTime,
        monthly,
        firstYear: oneTime + monthly * 12,
        included: true,
      } satisfies ItemRow,
    ]);
  }

  onCellValueChanged(e: CellValueChangedEvent<ItemRow>) {
    if (e.colDef.field !== 'included' || !e.data || e.node.rowPinned) return;
    this.toggle.emit({ optionId: e.data.optionId, componentId: e.data.componentId, included: Boolean(e.newValue) });
  }
}

function escape(s: string) {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}

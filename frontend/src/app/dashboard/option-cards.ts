import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import type { SolutionOption } from '../core/models';
import { IMPACT_LABEL, MoneyPipe, type Fx } from '../core/format';

/** Compact, scannable cards - one per option. Clicking a card selects it and shows its details below. */
@Component({
  selector: 'app-option-cards',
  imports: [MoneyPipe],
  template: `
    <div class="cards" role="listbox" aria-label="Options">
      @for (c of cards(); track c.o.id) {
        <button
          type="button"
          class="card opt"
          role="option"
          [class.on]="c.o.id === selectedId()"
          [attr.aria-selected]="c.o.id === selectedId()"
          (click)="select.emit(c.o.id)"
        >
          <div class="media" [class.noimg]="!c.image">
            @if (c.image) {
              <img [src]="c.image" [alt]="c.mainTitle" loading="lazy" referrerpolicy="no-referrer" />
            } @else {
              <span class="ph">{{ c.o.approach.charAt(0) }}</span>
            }
            <span class="rank" [class.top]="c.o.rank === 1">#{{ c.o.rank }}</span>
          </div>
          <div class="tags">
            @if (c.o.id === recommendedId()) {
              <span class="tag rec">★ Recommended</span>
            }
            @if (c.o.matchesRequest) {
              <span class="tag asked">You asked</span>
            }
          </div>
          <div class="name" [title]="c.o.name">{{ c.o.name }}</div>
          <div class="type">{{ c.o.approach }} · {{ c.items }} {{ c.items === 1 ? 'item' : 'items' }}</div>
          <div class="prices">
            <div>
              <small>Pay today</small>
              <b class="num">{{ c.o.cost.upfrontTotal | money: true : fx() }}</b>
            </div>
            <div>
              <small>First year</small>
              <b class="num">{{ c.o.cost.firstYearTotal | money: true : fx() }}</b>
            </div>
          </div>
          <div class="foot">
            <span class="chip {{ c.o.affordability.impact }}">{{ impactLabel[c.o.affordability.impact] }}</span>
            @if (c.o.cost.monthlyRecurring > 0) {
              <span class="mo">+{{ c.o.cost.monthlyRecurring | money: true : fx() }}/mo</span>
            }
            <span class="score num" title="Engine score out of 10">{{ c.o.score?.total?.toFixed(1) }}</span>
          </div>
        </button>
      }
    </div>
  `,
  styles: `
    :host { display: block; }
    .cards { display: grid; grid-auto-flow: column; grid-auto-columns: minmax(220px, 1fr); gap: 12px; overflow-x: auto; padding: 2px 2px 8px; scroll-snap-type: x proximity; }
    .opt { text-align: left; padding: 12px; display: flex; flex-direction: column; gap: 6px; cursor: pointer; scroll-snap-align: start; transition: border-color .15s, transform .1s, box-shadow .15s; min-width: 0; color: inherit; font: inherit; }
    .opt:hover { border-color: var(--line-strong); transform: translateY(-1px); }
    .opt.on { border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-glow); }
    .media { position: relative; height: 110px; border-radius: 10px; background: #fff; display: grid; place-items: center; overflow: hidden; }
    .media img { max-width: 92%; max-height: 100px; object-fit: contain; }
    .media.noimg { background: radial-gradient(120px 80px at 30% 20%, rgba(91,140,255,.35), transparent 70%), radial-gradient(120px 80px at 80% 90%, rgba(139,92,246,.35), transparent 70%), var(--surface-2); }
    .ph { font-family: var(--font-display); font-size: 40px; font-weight: 700; color: #e8ecf7; opacity: .9; }
    .rank { position: absolute; top: 6px; left: 6px; font-size: 11px; font-weight: 700; padding: 2px 7px; border-radius: 999px; background: rgba(13,17,27,.85); color: #e8ecf7; }
    .rank.top { background: linear-gradient(135deg,#5b8cff,#8b5cf6); }
    .tags { display: flex; gap: 6px; flex-wrap: wrap; min-height: 18px; }
    .tag { font-size: 10px; font-weight: 700; letter-spacing: .04em; text-transform: uppercase; border-radius: 999px; padding: 1px 7px; border: 1px solid; }
    .tag.rec { color: var(--mint); border-color: rgba(52,211,153,.45); }
    .tag.asked { color: #ffc439; border-color: rgba(255,196,57,.5); }
    .name { font-weight: 700; line-height: 1.25; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; min-height: 2.5em; }
    .type { font-size: 12px; color: var(--text-3); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .prices { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-top: 2px; }
    .prices small { display: block; font-size: 10px; text-transform: uppercase; letter-spacing: .08em; color: var(--text-3); }
    .prices b { font-size: 16px; }
    .foot { display: flex; align-items: center; gap: 8px; margin-top: 2px; }
    .mo { font-size: 11px; color: var(--text-2); white-space: nowrap; }
    .foot { flex-wrap: wrap; row-gap: 4px; }
    .score { margin-left: auto; font-weight: 700; font-size: 13px; color: var(--text-2); }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class OptionCards {
  solutions = input.required<SolutionOption[]>();
  selectedId = input<string | undefined>();
  recommendedId = input<string | undefined>();
  fx = input<Fx | null>(null);
  select = output<string>();

  protected readonly impactLabel = IMPACT_LABEL;

  protected cards = computed(() =>
    [...this.solutions()]
      .sort((a, b) => (a.rank ?? 99) - (b.rank ?? 99))
      .map((o) => {
        const included = o.components.filter((c) => c.included);
        // The "main" product: the priciest included one-time item (the fridge, the console…).
        const main = [...included].filter((c) => !c.recurringMonthly).sort((a, b) => b.unitPrice - a.unitPrice)[0] ?? included[0];
        const image = included.find((c) => c.id === main?.id && c.image)?.image ?? included.find((c) => c.image)?.image;
        return { o, image, mainTitle: main?.title ?? o.name, items: included.length };
      }),
  );
}

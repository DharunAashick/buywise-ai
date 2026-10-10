import { ChangeDetectionStrategy, Component, inject, OnInit } from '@angular/core';
import { BuyWiseStore } from './core/buywise.store';
import { ChatPanel } from './chat/chat-panel';
import { Dashboard } from './dashboard/dashboard';
import { CheckoutPanel } from './checkout/checkout-panel';

@Component({
  selector: 'app-root',
  imports: [ChatPanel, Dashboard, CheckoutPanel],
  templateUrl: './app.html',
  styleUrl: './app.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class App implements OnInit {
  protected store = inject(BuyWiseStore);

  ngOnInit() {
    this.store.init();
  }
}

// Loads the PayPal JS SDK once, for the configured sandbox client id.

declare global {
  interface Window {
    paypal?: {
      Buttons: (opts: Record<string, unknown>) => { render: (el: HTMLElement) => Promise<void>; close?: () => void; isEligible?: () => boolean };
    };
  }
}

let loading: Promise<NonNullable<Window['paypal']>> | undefined;

export function loadPayPal(clientId: string, currency = 'USD'): Promise<NonNullable<Window['paypal']>> {
  if (window.paypal) return Promise.resolve(window.paypal);
  loading ??= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    const params = new URLSearchParams({ 'client-id': clientId, currency, intent: 'capture', components: 'buttons' });
    s.src = `https://www.paypal.com/sdk/js?${params}`;
    s.async = true;
    s.onload = () => (window.paypal ? resolve(window.paypal) : reject(new Error('PayPal SDK failed to initialise')));
    s.onerror = () => {
      loading = undefined;
      reject(new Error('Could not load the PayPal SDK'));
    };
    document.head.appendChild(s);
  });
  return loading;
}

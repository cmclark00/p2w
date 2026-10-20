'use strict';
// Public connection checks use the same bounded bridge as the staff tool.
// No login, pricing records, saved data, or automatic checks on this page.
for (const kind of ['gs', 'ebay']) {
  const button = document.getElementById(`${kind}-check`);
  button.addEventListener('click', async () => {
    const output = document.getElementById(`${kind}-result`);
    const url = document.getElementById(`${kind}-url`).value.trim();
    button.disabled = true;
    output.textContent = 'Checking one listing…';
    try {
      if (kind === 'ebay' && !await window.P2WEbayHelper.available()) {
        output.textContent = 'Helper not connected. Enable Play2Win Market Helper in Chrome, then reload this page.';
        return;
      }
      const result = await (kind === 'gs' ? window.P2WGameStopHelper : window.P2WEbayHelper).check(url);
      if (!result) {
        output.textContent = 'Helper not connected. Enable Play2Win Market Helper in Chrome, then reload this page.';
        return;
      }
      const labels = { in: 'In stock online', out: 'Out of stock online', sold: 'Sold', ended: 'Ended without a confirmed sale', offer: 'Accepted offer or hidden final price', unknown: 'Unverified — open the original listing to check' };
      const price = result.state === 'sold' && Number.isSafeInteger(result.price) ? ` · $${(result.price / 100).toFixed(2)}` : '';
      output.textContent = (labels[result.state] || labels.unknown) + price + (result.title ? ` · ${result.title}` : '');
    } catch (_) {
      output.textContent = 'Check unavailable. Reload this page or review the listing manually.';
    } finally { button.disabled = false; }
  });
}

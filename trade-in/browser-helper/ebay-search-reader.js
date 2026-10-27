'use strict';
// Read only the current sold-results list. Never follow recommendations or submit forms.
function parseEbaySearchCard(card) {
  const id = String(card.url || '').match(/^https:\/\/(?:www\.)?ebay\.com\/itm\/(?:[^/?]+\/)?(\d{9,15})(?:[/?#]|$)/)?.[1];
  const date = String(card.sold || '').match(/^Sold\s+([A-Z][a-z]{2}\s+\d{1,2},\s+\d{4})$/)?.[1];
  const time = date && Date.parse(date + ' 12:00:00 GMT');
  const price = String(card.price || '').match(/^(?:US\s*)?\$([\d,]+(?:\.\d{2})?)$/);
  if (!id || !time || !card.positive || !price || !card.title || card.title.length > 450) return null;
  const cents = Math.round(Number(price[1].replace(/,/g, '')) * 100);
  if (!Number.isSafeInteger(cents) || cents <= 0 || cents >= 100000000) return null;
  const offer = card.struck || /best offer accepted|accepted (?:best )?offer/i.test(card.details || '');
  const delivery = String(card.shipping || '');
  const shipping = /^Free (?:delivery|shipping)$/i.test(delivery) ? 0
    : /^\+\$[\d,.]+ (?:delivery|shipping)$/i.test(delivery) ? Math.round(Number(delivery.match(/[\d,.]+/)[0].replace(/,/g, '')) * 100) : null;
  return { id, url: `https://www.ebay.com/itm/${id}`, title: card.title, price: cents,
    date: new Date(time).toISOString().slice(0, 10), conditionText: String(card.condition || '').slice(0, 100),
    state: offer ? 'offer' : 'sold', shipping, source: 'ebay-search' };
}
function readEbaySearch(doc, href, query, page = 1) {
  const unknown = { state: 'unknown', reason: 'Search unavailable. Sign in to eBay or review the search manually.', sales: [] };
  let u;
  try { u = new URL(href); } catch (_) { return unknown; }
  if (u.protocol !== 'https:' || !['www.ebay.com', 'ebay.com'].includes(u.hostname) || u.pathname !== '/sch/i.html'
    || u.searchParams.get('LH_Sold') !== '1' || u.searchParams.get('LH_Complete') !== '1'
    || u.searchParams.get('_nkw') !== query || u.searchParams.get('_sop') !== '16' || Number(u.searchParams.get('_pgn') || 1) !== page) return unknown;
  const visible = el => !!el && el.getClientRects().length > 0 && !el.closest('[aria-hidden="true"], .s-clipped');
  const text = el => visible(el) ? el.textContent.replace(/\s+/g, ' ').trim() : '';
  const heading = text(doc.querySelector('#srp-results-heading'));
  if (!/^\d[\d,]*\+? results? for\b/i.test(heading)) return unknown;
  const cards = [...doc.querySelectorAll('#srp-river-results li.s-card')].filter(visible).slice(0, 240);
  let skipped = 0;
  const sales = [];
  for (const card of cards) {
    const titleEl = card.querySelector('.s-card__title .su-styled-text');
    const status = card.querySelector('.s-card__caption [aria-label="Sold Item"]');
    const prices = [...card.querySelectorAll('.s-card__price')].filter(visible);
    const p = prices.length === 1 ? prices[0] : null;
    const lines = [...card.querySelectorAll('.s-card__attribute-row')].map(text);
    const condition = [...card.querySelectorAll('.s-card__subtitle')].map(text)
      .find(t => /^(?:Pre-Owned|Used|New \(Other\)|Brand New|New|Open box|For parts or not working|.+refurbished)$/i.test(t));
    const row = parseEbaySearchCard({ title: text(titleEl), url: titleEl?.closest('a')?.href,
      sold: text(status), positive: !!status?.classList.contains('positive'), price: text(p),
      struck: !!p && [p, ...p.querySelectorAll('*')].some(el => visible(el) &&
        (el.matches('s, del, .strikethrough') || doc.defaultView.getComputedStyle(el).textDecorationLine.includes('line-through'))),
      condition, details: lines.join(' '), shipping: lines.find(t => /^(?:\+\$|Free (?:delivery|shipping))/i.test(t)) });
    if (row) sales.push(row); else skipped++;
  }
  // Zero is valid only with an explicit zero-result heading. Layout changes are failures.
  if (!sales.length && !/^0 results? for\b/i.test(heading)) return { ...unknown, reason: 'Sold results could not be read reliably. Review eBay manually.' };
  const more = visible(doc.querySelector('a.pagination__next[href]'));
  return { state: 'ready', sales, page, sorted: true, more, skipped, partial: skipped > 0,
    reason: more ? 'More sold results are available on eBay.' : skipped ? 'Some result cards could not be read.' : '' };
}
if (typeof chrome !== 'undefined') {
  chrome.runtime.onMessage.addListener((message, sender, respond) => {
    if (message?.type !== 'P2W_EBAY_SEARCH_READ' || sender.id !== chrome.runtime.id || typeof message.query !== 'string') return false;
    let last = '', stable = 0, elapsed = 0;
    const timer = setInterval(() => {
      elapsed += 500;
      const value = readEbaySearch(document, location.href, message.query, message.page ?? 1), signature = JSON.stringify(value);
      stable = signature === last ? stable + 500 : 0; last = signature;
      if (elapsed >= 12000 || value.state === 'ready' && document.readyState === 'complete' && elapsed >= 2000 && stable >= 1000) {
        clearInterval(timer); respond(value);
      }
    }, 500);
    return true;
  });
  chrome.runtime.sendMessage({ type: 'P2W_EBAY_SEARCH_READY' }).catch(() => {});
}

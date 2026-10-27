'use strict';
// Read only the original item's status/title/price, never recommendations or seller prose.
function readEbaySale(doc, id, href) {
  const unknown = { state: 'unknown' };
  let url;
  try { url = new URL(href); } catch (_) { return unknown; }
  if (url.protocol !== 'https:' || !/^\d{9,15}$/.test(id) || !['www.ebay.com', 'ebay.com'].includes(url.hostname) || !new RegExp(`/itm/(?:[^/]+/)?${id}/?$`).test(url.pathname)) return unknown;
  const visible = el => !!el && el.getClientRects().length > 0;
  // Archived items can expose only the original condensed card: no visible h1
  // or price panel. Its ENDED badge is sufficient negative evidence, but its
  // SOLD badge/asking price alone must never verify a sold amount.
  const card = doc.querySelector('.x-vi-evo-cvip-container--condensed .x-item-condensed-card');
  const cardTitle = card?.querySelector('.x-item-condensed-card__title .ux-textspans');
  const cardStatus = card?.querySelector('.x-item-condensed-card__banner .signal');
  if ([card, cardTitle, cardStatus].every(visible)
    && /^ended$/i.test(cardStatus.textContent.trim()) && cardTitle.textContent.trim()) {
    return { state: 'ended', id, title: cardTitle.textContent.replace(/\s+/g, ' ').trim() };
  }
  const main = doc.querySelector('#mainContent');
  const heading = main?.querySelector('h1.x-item-title__mainTitle');
  const section = main?.querySelector('.x-price-section');
  const primary = section?.querySelector('.x-price-primary');
  if (![main, heading].every(visible)) return unknown;
  const title = heading.textContent.replace(/\s+/g, ' ').trim();
  const statuses = [...doc.querySelectorAll('.ux-layout-section__textual-display--statusMessage')].filter(visible).map(e => e.textContent.replace(/\s+/g, ' ').trim());
  const sold = statuses.some(t => /^This (?:listing|item) (?:was )?sold\b/i.test(t));
  const ended = statuses.some(t => /^This (?:listing|item) (?:(?:was|has) )?ended\b/i.test(t));
  if (!title || sold && ended) return unknown;
  if (ended && !sold) return { state: 'ended', id, title };
  if (![section, primary].every(visible)) return unknown;
  const offer = [...section.querySelectorAll('.x-additional-info')].filter(visible).some(e => /\bbest offer accepted\b|\baccepted (?:a )?best offer\b/i.test(e.textContent));
  const strike = [...primary.querySelectorAll('span, s, del')].filter(visible).some(e =>
    /\$\s*[\d,]+/.test(e.textContent) && (e.matches('s, del, .ux-textspans--STRIKETHROUGH')
      || /line-through/.test(doc.defaultView?.getComputedStyle(e).textDecorationLine || '')));
  if (offer || strike) return { state: 'offer', id, title };
  // The collapsed SOLD summary can show an asking price. Full item markup is required above.
  if (!sold) return unknown;
  const prices = [...primary.querySelectorAll('.x-price-primary__price')].filter(visible).map(e => e.textContent.trim());
  if (prices.length !== 1 || !/^US\s*\$\s*[\d,]+(?:\.\d{2})?$/.test(prices[0])) return unknown;
  const price = Math.round(Number(prices[0].replace(/[^\d.]/g, '')) * 100);
  const conditionNode = main.querySelector('.x-item-condition-text');
  const conditionText = visible(conditionNode) ? conditionNode.textContent.trim().match(/^(Brand New|New \(Other\)|New|Pre-Owned|Used|Open box|For parts or not working)(?=\s|:|$)/i)?.[1] : null;
  return Number.isSafeInteger(price) && price > 0 ? { state: 'sold', id, title, price, ...(conditionText ? { conditionText } : {}) } : unknown;
}
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (sender.id !== chrome.runtime.id || message?.type !== 'P2W_EBAY_READ' || !/^\d{9,15}$/.test(message.id)
    || !new RegExp(`/itm/(?:[^/]+/)?${message.id}/?$`).test(location.pathname)) return false;
  let previous = '', stableSince = 0, opened = false;
  const started = Date.now();
  const timer = setInterval(() => {
    // The one permitted click expands read-only listing details. Never follow a relisted item.
    if (!opened) {
      const original = [...document.querySelectorAll('button')].find(b => b.getClientRects().length && /^(?:See original listing\s*)+$/i.test(b.textContent.trim()));
      if (original) { opened = true; original.click(); }
    }
    const value = readEbaySale(document, message.id, location.href), key = JSON.stringify(value);
    if (key !== previous) { previous = key; stableSince = Date.now(); }
    if (document.readyState === 'complete' && value.state !== 'unknown' && Date.now() - started >= 2000 && Date.now() - stableSince >= 1000) {
      clearInterval(timer); respond(value);
    } else if (Date.now() - started > 9000) { clearInterval(timer); respond({ state: 'unknown' }); }
  }, 500);
  return true;
});
chrome.runtime.sendMessage({ type: 'P2W_EBAY_READY' }).catch(() => {});

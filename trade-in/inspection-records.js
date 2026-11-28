'use strict';

let inspectionId = null;
let completedInspection = null;
let openedInspection = null;
let searchVersion = 0;

const formatSaved = value => new Date(value).toLocaleString();

async function inspectionRequest(action, body) {
  const response = await fetch('api.php?route=inspections/' + action, {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify(body)
  });
  if (response.status === 401) {
    const error = new Error('Your sign-in expired.');
    error.signIn = true;
    throw error;
  }
  const result = await response.json().catch(() => null);
  if (!response.ok || !result) {
    throw new Error(result?.['error-message'] || 'Could not confirm the request. Try again.');
  }
  return result;
}

function showRequestError(node, error) {
  node.textContent = error instanceof TypeError ? 'Could not reach the store. Check the connection and try again.' : error.message;
  if (error.signIn) {
    node.append(' ');
    add(node, 'a', {href: location.pathname, target: '_blank', rel: 'noopener'}, 'Sign in in a new tab');
    node.append(', then return here and retry.');
  }
}

saveButton.onclick = async () => {
  if (completedInspection || saveButton.disabled) return;
  if (!$('intake').value.trim() && !$('serial').value.trim()) {
    show(0);
    const number = $('intake');
    number.focus();
    number.setCustomValidity('Enter an intake number or a serial number so staff can find this inspection.');
    number.reportValidity();
    number.setCustomValidity('');
    return;
  }
  // Keep this ID across retries, including a lost response after a successful write.
  if (!inspectionId) {
    inspectionId = Array.from(crypto.getRandomValues(new Uint8Array(16)), byte => byte.toString(16).padStart(2, '0')).join('');
  }
  const fields = Object.fromEntries(records.map(r => [r.name, r.read()]));
  saveButton.disabled = true;
  saveStatus.textContent = 'Saving inspection…';
  form.inert = true;
  $('logout').disabled = true;
  try {
    const result = await inspectionRequest('save', {id: inspectionId, fields});
    completedInspection = {saved: result.saved, fields};
    edited = false;
    for (const control of form.querySelectorAll('input,textarea')) control.disabled = true;
    saveStatus.textContent = 'Saved ' + formatSaved(result.saved) + '. Staff can now find this inspection by its recorded number.';
  } catch (error) {
    showRequestError(saveStatus, error);
  } finally {
    form.inert = false;
    saveButton.disabled = Boolean(completedInspection);
    $('logout').disabled = false;
  }
};

function clearDetail() {
  openedInspection = null;
  $('savedPanel').hidden = true;
  $('savedDetail').replaceChildren();
}

$('findOpen').onclick = () => {
  $('archive').showModal();
  $('lookupNumber').focus();
};
$('closeArchive').onclick = () => $('archive').close();
$('archive').addEventListener('close', () => {
  searchVersion++;
  clearDetail();
  $('lookup').reset();
  $('matches').replaceChildren();
  $('searchStatus').replaceChildren();
});

async function openInspection(id) {
  const version = ++searchVersion;
  clearDetail();
  $('searchStatus').textContent = 'Opening inspection…';
  try {
    const result = await inspectionRequest('open', {id});
    if (version !== searchVersion) return;
    openedInspection = result;
    $('savedTime').textContent = 'Saved ' + formatSaved(result.saved);
    renderReport($('savedDetail'), false, result);
    $('savedPanel').hidden = false;
    $('savedTitle').focus();
    $('searchStatus').textContent = '';
  } catch (error) {
    if (version === searchVersion) showRequestError($('searchStatus'), error);
  }
}

async function searchInspections(number, offset = 0) {
  const version = ++searchVersion;
  clearDetail();
  const matches = $('matches');
  if (!offset) matches.replaceChildren();
  const oldMore = matches.querySelector('[data-more]');
  if (oldMore) oldMore.disabled = true;
  $('searchStatus').textContent = 'Searching…';
  try {
    const result = await inspectionRequest('search', {number, offset});
    if (version !== searchVersion) return;
    oldMore?.remove();
    for (const row of result.matches) {
      const line = add(matches, 'p', {});
      const label = [row.model, row.intake && 'Intake ' + row.intake, row.serial && 'Serial ' + row.serial, formatSaved(row.saved)];
      const button = add(line, 'button', {type: 'button'}, label.filter(Boolean).join(' · '));
      button.onclick = () => openInspection(row.id);
    }
    const count = offset + result.matches.length;
    $('searchStatus').textContent = count
      ? count + (count === 1 ? ' matching inspection' : ' matching inspections') + ' shown.'
      : 'No inspection found. Check the full serial or intake number and try again.';
    if (result.more) {
      const more = add(matches, 'button', {type: 'button', 'data-more': ''}, 'Show more matches');
      more.onclick = () => searchInspections(number, count);
    }
  } catch (error) {
    if (version === searchVersion) showRequestError($('searchStatus'), error);
  } finally {
    if (oldMore) oldMore.disabled = false;
  }
}

$('lookup').onsubmit = event => {
  event.preventDefault();
  searchInspections($('lookupNumber').value.trim());
};
$('printSaved').onclick = () => {
  renderReport($('report'), true, openedInspection);
  window.print();
};

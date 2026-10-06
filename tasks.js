'use strict';

// Bottoni dei processi da incorporare nelle pagine cliente di Notion.
// Esempio: tasks.html?client=FERRUCCI%20GROUP&nome=FERRUCCI
// Il backend decide titoli, fasi, dipartimenti e manager: qui si raccolgono solo i dati.
const API_URL = 'https://pvuixvdiladlxzgkwszq.supabase.co/functions/v1/vendora-brief';
const KEY_STORAGE = 'vendoraBriefKey'; // la stessa chiave del form brief
// Etichette mostrate prima dell'accesso; i dettagli (passi, titoli) arrivano dal backend.
const BUTTONS = [{ id: 'ottimizzazione-360', icon: '🎯', label: 'Ottimizza prodotto a 360°' }];
const ASIN_RE = /^[A-Z0-9]{10}$/;
const MAX_ASINS = 30;

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const keyStore = {
  get() { try { return sessionStorage.getItem(KEY_STORAGE) || ''; } catch { return ''; } },
  set(value) { try { value ? sessionStorage.setItem(KEY_STORAGE, value) : sessionStorage.removeItem(KEY_STORAGE); } catch { /* storage non disponibile */ } },
};

let appKey = keyStore.get();
let catalog = null; // { processes, clients, marketplaces }
let active = null; // processo aperto
let nameTouched = false;
let busy = false;

class ApiError extends Error {
  constructor(status, data) {
    super(data.error || `Errore ${status}`);
    this.status = status;
    this.data = data;
  }
}

function setStatus(el, text, kind = '') {
  el.textContent = text;
  el.className = `status${kind ? ` ${kind}` : ''}`;
}

async function api(params, options = {}) {
  const url = new URL(API_URL);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  let res;
  try {
    res = await fetch(url, { ...options, headers: { 'X-App-Key': appKey, ...(options.body ? { 'Content-Type': 'application/json' } : {}) } });
  } catch {
    throw new ApiError(0, { error: 'Connessione non riuscita: controlla la rete e riprova.' });
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, data);
  return data;
}

// --- Bottoni e pannello ---
function renderButtons(list) {
  $('buttons').replaceChildren(...list.map((p) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'pill';
    b.dataset.process = p.id;
    b.setAttribute('aria-expanded', 'false');
    b.setAttribute('aria-controls', 'panel');
    b.textContent = `${p.icon} ${p.label}`;
    b.addEventListener('click', () => (active?.id === p.id && !$('panel').hidden ? closePanel() : openPanel(p.id)));
    return b;
  }));
}

function markButtons() {
  for (const b of document.querySelectorAll('.pill')) b.setAttribute('aria-expanded', String(!$('panel').hidden && b.dataset.process === active?.id));
}

function processInfo(id) {
  return catalog?.processes.find((p) => p.id === id) || BUTTONS.find((p) => p.id === id);
}

async function openPanel(id) {
  if (busy) return;
  active = processInfo(id);
  $('panel').hidden = false;
  $('panelTitle').textContent = `${active.icon} ${active.label}`;
  $('panelDesc').textContent = active.description || '';
  $('result').hidden = true;
  markButtons();
  if (!appKey) return showKeyForm();
  await loadCatalog();
}

function closePanel() {
  if (busy) return;
  $('panel').hidden = true;
  markButtons();
  document.querySelector(`.pill[data-process="${active?.id}"]`)?.focus();
}

function showKeyForm(message = '') {
  $('genForm').hidden = true;
  $('keyForm').hidden = false;
  setStatus($('authStatus'), message, message ? 'err' : '');
  $('key').focus();
}

async function loadCatalog() {
  try {
    if (!catalog) {
      setStatus($('genStatus'), '');
      catalog = await api({ action: 'processes' });
      renderButtons(catalog.processes);
      fillOptions();
    }
    active = processInfo(active.id);
    if (!active?.steps) throw new ApiError(404, { error: 'Processo non disponibile: ricarica la pagina.' });
    $('panelDesc').textContent = active.description;
    $('keyForm').hidden = true;
    $('genForm').hidden = false;
    markButtons();
    renderPreview();
    ($('client').value ? ($('marketplace').value ? $('asins') : $('marketplace')) : $('client')).focus();
  } catch (e) {
    if (e.status === 401) {
      appKey = '';
      keyStore.set('');
    }
    showKeyForm(e.status === 401 ? 'Chiave non valida: inseriscila di nuovo.' : e.message);
  }
}

function fillOptions() {
  const wanted = params.get('client') || '';
  $('client').replaceChildren(new Option('Scegli il cliente…', ''), ...catalog.clients.map((c) => new Option(c, c)));
  $('client').value = catalog.clients.includes(wanted) ? wanted : '';
  $('marketplace').replaceChildren(new Option('Scegli la nazione…', ''), ...catalog.marketplaces.map((m) => new Option(m, m)));
  const market = (params.get('nazione') || '').toUpperCase();
  $('marketplace').value = catalog.marketplaces.includes(market) ? market : '';
  $('name').value = (params.get('nome') || $('client').value).trim();
}

// --- Dati e anteprima ---
const asinList = () => [...new Set($('asins').value.toUpperCase().split(/[\s,;]+/).filter(Boolean))];
const cleanName = () => $('name').value.trim().replace(/\s+/g, ' ');
const fill = (template, values) => template.replace(/\{(\w+)\}/g, (_, k) => values[k] ?? '');

function titleValues() {
  const asins = asinList();
  return {
    nome: cleanName() || 'NOME CLIENTE',
    nazione: $('marketplace').value || 'NAZIONE',
    asin: asins.length ? asins.join(', ') : 'ASIN',
    processo: active.macro,
  };
}

function renderPreview() {
  if (!active?.steps) return;
  const values = titleValues();
  const total = active.steps.length + 1;
  $('previewTitle').textContent = `Anteprima delle ${total} task (1 macro + ${active.steps.length} micro)`;
  $('create').textContent = `Crea ${total} task`;
  $('previewMacro').textContent = `MACRO · ${fill(active.macroTitle, values)}`;
  const items = active.steps.map((s) => {
    const li = document.createElement('li');
    const meta = document.createElement('span');
    meta.className = 'meta';
    meta.textContent = ` — micro-fase ${s.micro} · ${s.department}${s.manager ? ` · ${s.manager}` : ''}`;
    li.append(fill(active.stepTitle, { ...values, azione: s.action }), meta);
    return li;
  });
  $('preview').replaceChildren(...items);
}

function fieldError(id, message) {
  $(`${id}Error`).textContent = message;
  if (message) $(id).setAttribute('aria-invalid', 'true');
  else $(id).removeAttribute('aria-invalid');
}

function validate() {
  const errors = {};
  if (!$('client').value) errors.client = 'Scegli il cliente dall’elenco.';
  const name = cleanName();
  if (!name) errors.name = 'Scrivi il nome da usare nei titoli.';
  else if (name.includes('|')) errors.name = 'Il carattere | non è ammesso.';
  if (!$('marketplace').value) errors.marketplace = 'Scegli la nazione di riferimento.';
  const asins = asinList();
  const invalid = asins.filter((a) => !ASIN_RE.test(a));
  if (!asins.length) errors.asins = 'Inserisci almeno un ASIN.';
  else if (invalid.length) errors.asins = `ASIN non valido: ${invalid.slice(0, 3).join(', ')}${invalid.length > 3 ? '…' : ''} (servono 10 caratteri, es. B0FZTK766T).`;
  else if (asins.length > MAX_ASINS) errors.asins = `Massimo ${MAX_ASINS} ASIN per volta.`;
  return errors;
}

function showErrors(errors) {
  for (const id of ['client', 'name', 'marketplace', 'asins']) fieldError(id, errors[id] || '');
  const first = ['client', 'name', 'marketplace', 'asins'].find((id) => errors[id]);
  if (first) $(first).focus();
  return !first;
}

// --- Creazione ---
function setBusy(value) {
  busy = value;
  for (const id of ['create', 'cancel', 'force', 'client', 'name', 'marketplace', 'asins', 'close']) $(id).disabled = value;
}

async function generate(force = false) {
  $('force').hidden = true;
  if (!showErrors(validate())) {
    setStatus($('genStatus'), 'Controlla i campi evidenziati.', 'err');
    return;
  }
  setBusy(true);
  setStatus($('genStatus'), `Creo ${active.steps.length + 1} task in Notion… (pochi secondi)`);
  try {
    const data = await api({ action: 'generate' }, {
      method: 'POST',
      body: JSON.stringify({ process: active.id, client: $('client').value, name: cleanName(), marketplace: $('marketplace').value, asins: $('asins').value, force }),
    });
    showResult(data);
  } catch (e) {
    if (e.status === 401) {
      appKey = '';
      keyStore.set('');
      showKeyForm('Chiave non valida: inseriscila di nuovo.');
    } else if (e.status === 409 && e.data.existing) {
      const el = $('genStatus');
      el.className = 'status warn';
      el.replaceChildren(`${e.message} `, link(e.data.existing.url, 'Apri la macro-task'), '. Vuoi crearle di nuovo?');
      $('force').hidden = false;
    } else {
      if (e.data?.fields) showErrors(e.data.fields);
      setStatus($('genStatus'), e.message, 'err');
    }
  } finally {
    setBusy(false);
  }
}

function link(url, text) {
  const a = document.createElement('a');
  a.href = /^https:\/\/(www\.)?notion\.so\//.test(url) ? url : '#';
  a.target = '_blank';
  a.rel = 'noopener';
  a.textContent = text;
  return a;
}

function showResult(data) {
  $('genForm').hidden = true;
  $('result').hidden = false;
  setStatus($('resultStatus'), `✓ Create ${data.tasks.length + 1} task in Notion per ${$('client').value}. Le trovi nel VENDORA DATABASE in «Da schedulare».`, 'ok');
  const row = (t, prefix = '') => {
    const li = document.createElement('li');
    const code = document.createElement('span');
    code.className = 'code';
    code.textContent = t.code || '';
    li.append(code, link(t.url, `${prefix}${t.title}`));
    if (t.department) {
      const meta = document.createElement('span');
      meta.className = 'meta';
      meta.textContent = ` — ${t.department}${t.manager ? ` · ${t.manager}` : ''}`;
      li.append(meta);
    }
    return li;
  };
  $('results').replaceChildren(row(data.macro, 'MACRO · '), ...data.tasks.map((t) => row(t)));
  $('again').focus();
}

function resetForm() {
  $('asins').value = '';
  setStatus($('genStatus'), '');
  $('force').hidden = true;
  showErrors({});
  $('result').hidden = true;
  $('genForm').hidden = false;
  renderPreview();
  $('asins').focus();
}

// --- Eventi ---
$('keyForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const value = $('key').value.trim();
  if (!value) return setStatus($('authStatus'), 'Inserisci la chiave del team.', 'err');
  appKey = value;
  $('keyBtn').disabled = true;
  setStatus($('authStatus'), 'Verifica della chiave…');
  catalog = null;
  await loadCatalog();
  if (!$('genForm').hidden) {
    keyStore.set(appKey);
    $('key').value = '';
  }
  $('keyBtn').disabled = false;
});
$('genForm').addEventListener('submit', (e) => {
  e.preventDefault();
  if (!busy) generate();
});
$('force').addEventListener('click', () => generate(true));
$('cancel').addEventListener('click', closePanel);
$('close').addEventListener('click', closePanel);
$('again').addEventListener('click', resetForm);
$('client').addEventListener('change', () => {
  if (!nameTouched) $('name').value = $('client').value;
  fieldError('client', '');
  renderPreview();
});
$('name').addEventListener('input', () => {
  nameTouched = true;
  fieldError('name', '');
  renderPreview();
});
$('marketplace').addEventListener('change', () => {
  fieldError('marketplace', '');
  renderPreview();
});
$('asins').addEventListener('input', () => {
  fieldError('asins', '');
  renderPreview();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !$('panel').hidden) closePanel();
});
if (params.get('nome')) nameTouched = true;

renderButtons(BUTTONS);

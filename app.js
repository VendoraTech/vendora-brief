'use strict';

const API_URL = 'https://pvuixvdiladlxzgkwszq.supabase.co/functions/v1/vendora-brief';
const KEY_STORAGE = 'vendoraBriefKey';
const TEXT_FIELDS = ['brand', 'variants', 'specs', 'problem', 'strengths', 'certificates', 'competitors', 'strategy'];
const REQUIRED = ['brand', 'marketplace', 'variants', 'specs', 'problem', 'strengths', 'competitors', 'strategy'];
const LABELS = {
  brand: 'Brand name', marketplace: 'Marketplace', variants: 'Formato / Taglia / Colore / Quantità',
  specs: 'Ingredienti / Specifiche', problem: 'Problema risolto', strengths: 'Punti di forza',
  certificates: 'Certificati / Allergeni', competitors: 'Top 3 competitor', strategy: 'Consigli strategici',
};

const $ = (id) => document.getElementById(id);
const markets = () => [...document.querySelectorAll('input[name=marketplace]')];
const session = {
  get() { try { return sessionStorage.getItem(KEY_STORAGE) || ''; } catch { return ''; } },
  set(value) { try { value ? sessionStorage.setItem(KEY_STORAGE, value) : sessionStorage.removeItem(KEY_STORAGE); } catch { /* storage non disponibile */ } },
};

let appKey = session.get();
let current = null; // { pageId, summary, baseline }
let dirty = false;
let pendingSwitch = '';
let searchTimer = 0;
let searchSeq = 0;

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
  for (const [k, v] of Object.entries(params)) if (v) url.searchParams.set(k, v);
  let res;
  try {
    res = await fetch(url, {
      ...options,
      headers: { 'X-App-Key': appKey, ...(options.body ? { 'Content-Type': 'application/json' } : {}) },
    });
  } catch {
    throw new ApiError(0, { error: 'Connessione non riuscita: controlla la rete e riprova.' });
  }
  const data = await res.json().catch(() => ({}));
  if (res.status === 401) logout('Chiave non valida: inseriscila di nuovo.');
  if (!res.ok) throw new ApiError(res.status, data);
  return data;
}

function logout(message = '') {
  appKey = '';
  session.set('');
  $('key').value = '';
  $('keyForm').hidden = false;
  $('taskBox').hidden = true;
  setStatus($('authStatus'), message, message ? 'err' : '');
  $('key').focus();
}

async function connect() {
  setStatus($('authStatus'), 'Verifica della chiave…');
  $('keyBtn').disabled = true;
  try {
    await searchTasks('');
    session.set(appKey);
    $('keyForm').hidden = true;
    $('taskBox').hidden = false;
    setStatus($('authStatus'), '');
    const requested = pageFromUrl();
    if (requested && !current) await loadBrief(requested);
    else $('search').focus();
  } catch (e) {
    if (e.status !== 401) setStatus($('authStatus'), e.message, 'err');
  } finally {
    $('keyBtn').disabled = false;
  }
}

function pageFromUrl() {
  const raw = new URLSearchParams(location.search).get('page') || '';
  const m = raw.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i) || raw.match(/[0-9a-f]{32}(?![0-9a-f])/i);
  return m ? m[0] : '';
}

const sameId = (a, b) => String(a).replace(/-/g, '') === String(b).replace(/-/g, '');

function optionLabel(t) {
  const text = [t.code, t.client, t.title || 'Task senza titolo'].filter(Boolean).join(' · ');
  return text.length > 140 ? `${text.slice(0, 139)}…` : text;
}

function renderOptions(tasks) {
  const list = current && !tasks.some((t) => sameId(t.id, current.pageId)) ? [current.summary, ...tasks] : tasks;
  const options = list.map((t) => {
    const o = new Option(optionLabel(t), t.id); // Option() usa textContent: niente HTML iniettato
    o.title = t.title;
    return o;
  });
  $('task').replaceChildren(new Option('Seleziona una task…', ''), ...options);
  $('task').value = current ? list.find((t) => sameId(t.id, current.pageId)).id : '';
}

async function searchTasks(q) {
  const seq = ++searchSeq;
  setStatus($('taskStatus'), 'Ricerca delle task…');
  const { tasks } = await api({ action: 'tasks', q });
  if (seq !== searchSeq) return; // risposta superata da una ricerca più recente
  renderOptions(tasks);
  setStatus($('taskStatus'), tasks.length
    ? `${tasks.length === 30 ? 'Le 30 task modificate più di recente' : `${tasks.length} task`}${q ? ` per «${q}»` : ''}. Usa la ricerca per trovarne altre.`
    : `Nessuna task trovata${q ? ` per «${q}»` : ''}.`);
}

function setBusy(busy) {
  for (const id of ['save', 'reload', 'task']) $(id).disabled = busy;
}

function snapshot(brief) {
  const values = {};
  for (const k of TEXT_FIELDS) values[k] = brief[k] || '';
  values.marketplace = [...(brief.marketplace || [])];
  return values;
}

function fillForm(brief) {
  current = {
    pageId: brief.pageId,
    summary: { id: brief.pageId, title: brief.title, client: brief.client, code: brief.code },
    baseline: snapshot(brief),
  };
  for (const k of TEXT_FIELDS) $(k).value = brief[k] || '';
  for (const box of markets()) box.checked = brief.marketplace.includes(box.value);
  $('taskTitle').textContent = [brief.code, brief.title].filter(Boolean).join(' · ');
  $('taskTitle').title = brief.title;
  $('completeness').textContent = brief.completeness || '';
  if (![...$('task').options].some((o) => sameId(o.value, brief.pageId))) {
    const o = new Option(optionLabel(current.summary), brief.pageId);
    o.title = brief.title;
    $('task').add(o, 1);
  }
  $('task').value = [...$('task').options].find((o) => sameId(o.value, brief.pageId)).value;
  clearErrors();
  dirty = false;
  $('form').hidden = false;
}

async function loadBrief(pageId) {
  setBusy(true);
  setStatus($('taskStatus'), 'Caricamento del brief da Notion…');
  setStatus($('formStatus'), '');
  try {
    const { brief } = await api({ action: 'brief', pageId });
    fillForm(brief);
    setStatus($('taskStatus'), 'Brief caricato da Notion.', 'ok');
  } catch (e) {
    if (e.status !== 401) setStatus($('taskStatus'), e.message, 'err');
    if (current) $('task').value = [...$('task').options].find((o) => sameId(o.value, current.pageId))?.value || '';
  } finally {
    setBusy(false);
  }
}

function collect() {
  const values = {};
  for (const k of TEXT_FIELDS) values[k] = $(k).value.trim();
  values.marketplace = markets().filter((b) => b.checked).map((b) => b.value);
  return values;
}

function clearErrors() {
  for (const k of [...TEXT_FIELDS, 'marketplace']) showError(k, '');
}

function showError(key, message) {
  $(`${key}Error`).textContent = message;
  document.querySelector(`[data-field="${key}"]`).classList.toggle('invalid', Boolean(message));
  const targets = key === 'marketplace' ? markets() : [$(key)];
  for (const el of targets) message ? el.setAttribute('aria-invalid', 'true') : el.removeAttribute('aria-invalid');
}

function focusField(key) {
  (key === 'marketplace' ? markets()[0] : $(key)).focus();
}

function validate(values) {
  clearErrors();
  const missing = REQUIRED.filter((k) => (k === 'marketplace' ? values[k].length === 0 : !values[k]));
  for (const k of missing) showError(k, k === 'marketplace' ? 'Seleziona almeno un marketplace.' : 'Campo obbligatorio.');
  if (missing.length) focusField(missing[0]);
  return missing.length === 0;
}

async function save(e) {
  e.preventDefault();
  if (!current) return;
  const values = collect();
  if (!validate(values)) {
    setStatus($('formStatus'), 'Compila i campi obbligatori evidenziati.', 'err');
    return;
  }
  setBusy(true);
  setStatus($('formStatus'), 'Salvataggio in Notion…');
  try {
    const data = await api({ action: 'brief' }, {
      method: 'POST',
      body: JSON.stringify({ pageId: current.pageId, brief: values, baseline: current.baseline }),
    });
    fillForm(data.brief);
    setStatus($('formStatus'), data.unchanged ? '✓ Nessuna modifica: il brief in Notion è già aggiornato' : '✓ Brief salvato e condiviso in Notion', 'ok');
  } catch (err) {
    if (err.status === 409 && err.data.conflicts) {
      // Al prossimo salvataggio questi campi verranno sovrascritti con i valori del form.
      for (const k of err.data.conflicts) current.baseline[k] = err.data.brief[k];
      const names = err.data.conflicts.map((k) => LABELS[k]).join(', ');
      setStatus($('formStatus'), `${err.message} Campi: ${names}. Premi «Ricarica» per vedere la versione aggiornata, oppure salva di nuovo per sovrascriverla.`, 'warn');
    } else if (err.status === 400 && err.data.fields) {
      for (const [k, msg] of Object.entries(err.data.fields)) showError(k, msg);
      focusField(Object.keys(err.data.fields)[0]);
      setStatus($('formStatus'), err.message, 'err');
    } else if (err.status !== 401) {
      setStatus($('formStatus'), err.message, 'err');
    }
  } finally {
    setBusy(false);
  }
}

$('keyForm').addEventListener('submit', (e) => {
  e.preventDefault();
  appKey = $('key').value.trim();
  if (!appKey) return setStatus($('authStatus'), 'Inserisci la chiave del team.', 'err');
  connect();
});

$('logout').addEventListener('click', () => logout());

$('search').addEventListener('input', () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    searchTasks($('search').value.trim()).catch((e) => {
      if (e.status !== 401) setStatus($('taskStatus'), e.message, 'err');
    });
  }, 350);
});

$('task').addEventListener('change', () => {
  const id = $('task').value;
  if (!id || (current && sameId(id, current.pageId))) return;
  if (dirty && pendingSwitch !== id) {
    pendingSwitch = id;
    $('task').value = [...$('task').options].find((o) => sameId(o.value, current.pageId)).value;
    setStatus($('taskStatus'), 'Hai modifiche non salvate: salvale, oppure seleziona di nuovo la task per scartarle.', 'warn');
    return;
  }
  pendingSwitch = '';
  loadBrief(id);
});

$('reload').addEventListener('click', () => current && loadBrief(current.pageId));

$('form').addEventListener('input', (e) => {
  dirty = true;
  const key = e.target.name === 'marketplace' ? 'marketplace' : e.target.id;
  if ($(`${key}Error`)?.textContent) showError(key, '');
  if ($('formStatus').classList.contains('ok')) setStatus($('formStatus'), 'Modifiche non salvate');
});
$('form').addEventListener('submit', save);

if (appKey) connect();
else $('key').focus();

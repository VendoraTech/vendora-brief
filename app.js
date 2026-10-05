'use strict';

const API_URL = 'https://pvuixvdiladlxzgkwszq.supabase.co/functions/v1/vendora-brief';
const KEY_STORAGE = 'vendoraBriefKey';
const TYPE_STORAGE = 'vendoraBriefType';

// Brief PERFORMANCE
const TEXT_FIELDS = ['brand', 'variants', 'specs', 'problem', 'strengths', 'certificates', 'competitors', 'strategy'];
const REQUIRED = ['brand', 'marketplace', 'variants', 'specs', 'problem', 'strengths', 'competitors', 'strategy'];
const LABELS = {
  brand: 'Brand name', marketplace: 'Marketplace', variants: 'Formato / Taglia / Colore / Quantità',
  specs: 'Ingredienti / Specifiche', problem: 'Problema risolto', strengths: 'Punti di forza',
  certificates: 'Certificati / Allergeni', competitors: 'Top 3 competitor', strategy: 'Consigli strategici',
};

// Brief CATALOGO: chiave API → id dell'elemento nel form
const OP_NODE = 'Variazione del nodo';
const OP_PARENT = 'Creazione di un parent';
const CAT_DOM = {
  operation: 'cOperation', asin: 'cAsin', marketplace: 'cMarketplace', currentNode: 'cCurrentNode', newNode: 'cNewNode',
  parentBrand: 'cParentBrand', parentName: 'cParentName', parentAsins: 'cParentAsins',
};
const CAT_LABELS = {
  operation: 'Operazione', asin: 'ASIN su cui operare', marketplace: 'Marketplace di riferimento',
  currentNode: 'Attuale nodo di navigazione', currentNodeId: 'Attuale nodo di navigazione', newNode: 'Nuovo nodo di navigazione',
  newNodeId: 'Nuovo nodo di navigazione', parentBrand: 'Marchio del parent', parentName: 'Nome parent', parentAsins: 'ASINs da agganciare',
};
const CAT_KEYS = ['operation', 'asin', 'marketplace', 'currentNode', 'currentNodeId', 'newNode', 'newNodeId', 'parentBrand', 'parentName', 'parentAsins'];

const $ = (id) => document.getElementById(id);
const markets = () => [...document.querySelectorAll('input[name=marketplace]')];
const storage = (name) => ({
  get() { try { return sessionStorage.getItem(name) || ''; } catch { return ''; } },
  set(value) { try { value ? sessionStorage.setItem(name, value) : sessionStorage.removeItem(name); } catch { /* storage non disponibile */ } },
});
const keyStore = storage(KEY_STORAGE);
const typeStore = storage(TYPE_STORAGE);

let appKey = keyStore.get();
let briefType = ['performance', 'catalogo'].includes(new URLSearchParams(location.search).get('type'))
  ? new URLSearchParams(location.search).get('type') : typeStore.get();
let current = null; // { pageId, summary, brief, baseline: { performance, catalogo } }
let dirty = false;
let pendingSwitch = '';
let pendingType = '';
let searchTimer = 0;
let searchSeq = 0;

const pickers = {
  currentNode: new NodePicker($('cCurrentNodePicker'), () => markDirty('cCurrentNode')),
  newNode: new NodePicker($('cNewNodePicker'), () => markDirty('cNewNode')),
};

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
  keyStore.set('');
  $('key').value = '';
  $('keyForm').hidden = false;
  $('typeBox').hidden = true;
  $('taskBox').hidden = true;
  setStatus($('authStatus'), message, message ? 'err' : '');
  $('key').focus();
}

async function connect() {
  setStatus($('authStatus'), 'Verifica della chiave…');
  $('keyBtn').disabled = true;
  try {
    await searchTasks('');
    keyStore.set(appKey);
    $('keyForm').hidden = true;
    $('typeBox').hidden = false;
    setStatus($('authStatus'), '');
    if (briefType) applyType(briefType);
    else {
      setStatus($('typeStatus'), 'Scegli il tipo di brief per continuare.');
      document.querySelector('input[name=briefType]').focus();
    }
    const requested = pageFromUrl();
    if (requested && !current) await loadBrief(requested);
  } catch (e) {
    if (e.status !== 401) setStatus($('authStatus'), e.message, 'err');
  } finally {
    $('keyBtn').disabled = false;
  }
}

// --- Tipo di brief ---
function applyType(type) {
  briefType = type;
  typeStore.set(type);
  for (const radio of document.querySelectorAll('input[name=briefType]')) radio.checked = radio.value === type;
  setStatus($('typeStatus'), '');
  $('taskBox').hidden = false;
  renderCurrent();
  if (!current) $('search').focus();
}

function renderCurrent() {
  $('form').hidden = !current || !briefType;
  if (!current || !briefType) return;
  const catalog = briefType === 'catalogo';
  $('perfFields').hidden = catalog;
  $('catalogFields').hidden = !catalog;
  $('completeness').textContent = (catalog ? current.brief.catalog?.completeness : current.brief.completeness) || '';
  prepareExport();
}

// --- Task ---
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

function catalogSnapshot(catalog = {}) {
  return Object.fromEntries(CAT_KEYS.map((k) => [k, catalog[k] || '']));
}

function fillForm(brief) {
  current = {
    pageId: brief.pageId,
    summary: { id: brief.pageId, title: brief.title, client: brief.client, code: brief.code },
    brief,
    baseline: { performance: snapshot(brief), catalogo: catalogSnapshot(brief.catalog) },
  };
  for (const k of TEXT_FIELDS) $(k).value = brief[k] || '';
  for (const box of markets()) box.checked = brief.marketplace.includes(box.value);
  fillCatalog(current.baseline.catalogo);
  $('taskTitle').textContent = [brief.code, brief.title].filter(Boolean).join(' · ');
  $('taskTitle').title = brief.title;
  if (![...$('task').options].some((o) => sameId(o.value, brief.pageId))) {
    const o = new Option(optionLabel(current.summary), brief.pageId);
    o.title = brief.title;
    $('task').add(o, 1);
  }
  $('task').value = [...$('task').options].find((o) => sameId(o.value, brief.pageId)).value;
  clearErrors();
  dirty = false;
  renderCurrent();
}

// --- Brief CATALOGO ---
function fillCatalog(c) {
  for (const radio of document.querySelectorAll('input[name=cOperation]')) radio.checked = radio.value === c.operation;
  $('cAsin').value = c.asin;
  $('cMarketplace').value = c.marketplace;
  $('cParentBrand').value = c.parentBrand;
  $('cParentName').value = c.parentName;
  $('cParentAsins').value = c.parentAsins;
  pickers.currentNode.set(c.currentNodeId ? { id: c.currentNodeId, path: c.currentNode } : null);
  pickers.newNode.set(c.newNodeId ? { id: c.newNodeId, path: c.newNode } : null);
  showOperation(c.operation);
  loadTree(c.marketplace);
}

function showOperation(op) {
  $('nodeFields').hidden = op !== OP_NODE;
  $('parentFields').hidden = op !== OP_PARENT;
}

async function loadTree(marketplace) {
  for (const p of Object.values(pickers)) p.setTree(null);
  if (!marketplace) return;
  try {
    const nodes = await NodeTrees.load(marketplace);
    if ($('cMarketplace').value !== marketplace) return; // nel frattempo è stato scelto un altro marketplace
    for (const p of Object.values(pickers)) p.setTree(nodes);
  } catch (e) {
    showError('cCurrentNode', e.message);
  }
}

const operationValue = () => document.querySelector('input[name=cOperation]:checked')?.value || '';
const parseAsins = (text) => [...new Set(text.toUpperCase().split(/[\s,;]+/).filter(Boolean))];

function collectCatalog() {
  const op = operationValue();
  const values = catalogSnapshot();
  values.operation = op;
  if (op === OP_NODE) {
    values.asin = parseAsins($('cAsin').value).join('\n');
    values.marketplace = $('cMarketplace').value;
    for (const key of ['currentNode', 'newNode']) {
      values[key] = pickers[key].value?.path || '';
      values[`${key}Id`] = pickers[key].value?.id || '';
    }
  } else if (op === OP_PARENT) {
    values.parentBrand = $('cParentBrand').value.trim();
    values.parentName = $('cParentName').value.trim();
    values.parentAsins = parseAsins($('cParentAsins').value).join('\n');
  }
  return values;
}

function validateCatalog(v) {
  clearErrors();
  const errors = {};
  const asinError = (text) => {
    const tokens = parseAsins(text);
    const invalid = tokens.filter((t) => !/^[A-Z0-9]{10}$/.test(t));
    if (!tokens.length) return 'Inserisci almeno un ASIN.';
    return invalid.length ? `ASIN non valido: ${invalid.slice(0, 3).join(', ')} (servono 10 caratteri, es. B0FZTK766T).` : '';
  };
  if (!v.operation) errors.operation = 'Scegli l’operazione da effettuare.';
  if (v.operation === OP_NODE) {
    errors.asin = asinError($('cAsin').value);
    if (!v.marketplace) errors.marketplace = 'Scegli il marketplace di riferimento.';
    if (!v.currentNodeId) errors.currentNode = 'Cerca e seleziona il nodo attuale dall’elenco.';
    if (!v.newNodeId) errors.newNode = 'Cerca e seleziona il nuovo nodo dall’elenco.';
    else if (v.newNodeId === v.currentNodeId) errors.newNode = 'Il nuovo nodo deve essere diverso da quello attuale.';
  }
  if (v.operation === OP_PARENT) {
    if (!v.parentBrand) errors.parentBrand = 'Campo obbligatorio.';
    if (!v.parentName) errors.parentName = 'Campo obbligatorio.';
    errors.parentAsins = asinError($('cParentAsins').value);
  }
  const keys = Object.keys(errors).filter((k) => errors[k]);
  for (const k of keys) showError(CAT_DOM[k], errors[k]);
  if (keys.length) focusField(CAT_DOM[keys[0]]);
  return keys.length === 0;
}

// --- Export ---
// I dati del brief salvato viaggiano nel frammento dell'URL (#...), che non viene mai inviato a
// nessun server: la pagina di export li legge nel browser, anche se Notion la apre in un'altra app.
function base64url(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function prepareExport() {
  const link = $('export');
  link.setAttribute('aria-disabled', 'true');
  const { brief, pageId } = current;
  const type = briefType;
  const common = { type, code: brief.code, client: brief.client, title: brief.title, pageId };
  const data = type === 'catalogo'
    ? { ...catalogSnapshot(brief.catalog), ...common, completeness: brief.catalog?.completeness || '' }
    : { ...snapshot(brief), ...common, completeness: brief.completeness };
  const bytes = new TextEncoder().encode(JSON.stringify(data));
  let fragment = `j=${base64url(bytes)}`;
  if ('CompressionStream' in window) {
    const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate-raw'));
    fragment = `z=${base64url(new Uint8Array(await new Response(stream).arrayBuffer()))}`;
  }
  if (!current || !sameId(current.pageId, pageId) || briefType !== type) return; // nel frattempo è cambiato qualcosa
  link.href = `export.html#${fragment}`;
  link.setAttribute('aria-disabled', 'false');
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

// --- Validazione e salvataggio ---
function collect() {
  const values = {};
  for (const k of TEXT_FIELDS) values[k] = $(k).value.trim();
  values.marketplace = markets().filter((b) => b.checked).map((b) => b.value);
  return values;
}

function clearErrors() {
  for (const k of [...TEXT_FIELDS, 'marketplace', ...Object.values(CAT_DOM)]) showError(k, '');
}

function fieldTargets(key) {
  const group = document.querySelectorAll(`input[name="${key}"]`);
  if (group.length) return [...group];
  return [$(key) || $(`${key}Input`)].filter(Boolean);
}

function showError(key, message) {
  $(`${key}Error`).textContent = message;
  document.querySelector(`[data-field="${key}"]`).classList.toggle('invalid', Boolean(message));
  for (const el of fieldTargets(key)) message ? el.setAttribute('aria-invalid', 'true') : el.removeAttribute('aria-invalid');
}

function focusField(key) {
  const target = fieldTargets(key).find((el) => !el.hidden && !el.disabled);
  (target || document.querySelector(`[data-field="${key}"] button`))?.focus();
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
  if (!current || !briefType) return;
  const catalog = briefType === 'catalogo';
  const values = catalog ? collectCatalog() : collect();
  if (!(catalog ? validateCatalog(values) : validate(values))) {
    setStatus($('formStatus'), 'Compila i campi obbligatori evidenziati.', 'err');
    return;
  }
  setBusy(true);
  setStatus($('formStatus'), 'Salvataggio in Notion…');
  try {
    const data = await api({ action: 'brief' }, {
      method: 'POST',
      body: JSON.stringify({ pageId: current.pageId, type: briefType, brief: values, baseline: current.baseline[briefType] }),
    });
    fillForm(data.brief);
    setStatus($('formStatus'), data.unchanged ? '✓ Nessuna modifica: il brief in Notion è già aggiornato' : '✓ Brief salvato e condiviso in Notion', 'ok');
  } catch (err) {
    if (err.status === 409 && err.data.conflicts) {
      // Al prossimo salvataggio questi campi verranno sovrascritti con i valori del form.
      const theirs = catalog ? err.data.brief.catalog : err.data.brief;
      for (const k of err.data.conflicts) current.baseline[briefType][k] = theirs[k];
      const names = [...new Set(err.data.conflicts.map((k) => (catalog ? CAT_LABELS : LABELS)[k]))].join(', ');
      setStatus($('formStatus'), `${err.message} Campi: ${names}. Premi «Ricarica» per vedere la versione aggiornata, oppure salva di nuovo per sovrascriverla.`, 'warn');
    } else if (err.status === 400 && err.data.fields) {
      const keys = Object.keys(err.data.fields).map((k) => (catalog ? CAT_DOM[k] : k)).filter(Boolean);
      Object.entries(err.data.fields).forEach(([k, msg]) => (catalog ? CAT_DOM[k] : k) && showError(catalog ? CAT_DOM[k] : k, msg));
      if (keys.length) focusField(keys[0]);
      setStatus($('formStatus'), err.message, 'err');
    } else if (err.status !== 401) {
      setStatus($('formStatus'), err.message, 'err');
    }
  } finally {
    setBusy(false);
  }
}

function markDirty(key) {
  dirty = true;
  if (key && $(`${key}Error`)?.textContent) showError(key, '');
  if ($('formStatus').classList.contains('ok')) setStatus($('formStatus'), 'Modifiche non salvate');
}

// --- Eventi ---
$('keyForm').addEventListener('submit', (e) => {
  e.preventDefault();
  appKey = $('key').value.trim();
  if (!appKey) return setStatus($('authStatus'), 'Inserisci la chiave del team.', 'err');
  connect();
});

$('logout').addEventListener('click', () => logout());

$('typeBox').addEventListener('change', (e) => {
  const type = e.target.value;
  if (e.target.name !== 'briefType' || type === briefType) return;
  if (dirty && pendingType !== type) {
    pendingType = type;
    for (const radio of document.querySelectorAll('input[name=briefType]')) radio.checked = radio.value === briefType;
    setStatus($('typeStatus'), 'Hai modifiche non salvate: salvale, oppure scegli di nuovo il tipo per scartarle.', 'warn');
    return;
  }
  pendingType = '';
  if (dirty && current) fillForm(current.brief); // scarta le modifiche non salvate
  applyType(type);
});

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

$('export').addEventListener('click', (e) => {
  if (dirty) {
    e.preventDefault();
    setStatus($('formStatus'), 'Hai modifiche non salvate: salva il brief prima di esportarlo.', 'warn');
  } else if ($('export').getAttribute('aria-disabled') === 'true') {
    e.preventDefault();
  }
});

$('catalogFields').addEventListener('change', (e) => {
  if (e.target.name === 'cOperation') showOperation(e.target.value);
});

$('cMarketplace').addEventListener('change', () => {
  // I nodi appartengono all'albero di un marketplace: cambiandolo vanno scelti di nuovo.
  const hadNodes = Object.values(pickers).some((p) => p.value);
  for (const p of Object.values(pickers)) p.set(null);
  loadTree($('cMarketplace').value);
  if (hadNodes) setStatus($('formStatus'), 'Marketplace cambiato: scegli di nuovo i nodi di navigazione.', 'warn');
});

$('form').addEventListener('input', (e) => {
  const t = e.target;
  if (t.closest('.picker')) return; // la ricerca nel selettore non è una modifica del brief
  markDirty(t.name === 'marketplace' ? 'marketplace' : t.name === 'cOperation' ? 'cOperation' : t.id);
});
$('form').addEventListener('submit', save);

if (appKey) connect();
else $('key').focus();

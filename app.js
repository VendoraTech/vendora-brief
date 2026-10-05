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
const OP_UPLOAD = 'Caricamenti GRAFICI';
const CAT_DOM = {
  operation: 'cOperation', asin: 'cAsin', marketplace: 'cMarketplace', currentNode: 'cCurrentNode', newNode: 'cNewNode',
  parentBrand: 'cParentBrand', parentName: 'cParentName', parentAsins: 'cParentAsins',
  uploadTypes: 'cUTypes', destMarketplaces: 'cUMarkets', driveLink: 'cUDrive',
};
const CAT_LABELS = {
  operation: 'Operazione', asin: 'ASIN su cui operare', marketplace: 'Marketplace di riferimento',
  currentNode: 'Attuale nodo di navigazione', currentNodeId: 'Attuale nodo di navigazione', newNode: 'Nuovo nodo di navigazione',
  newNodeId: 'Nuovo nodo di navigazione', parentBrand: 'Marchio del parent', parentName: 'Nome parent', parentAsins: 'ASINs da agganciare',
  uploadTypes: 'Tipo di caricamento', destMarketplaces: 'Marketplace di destinazione', driveLink: 'Link Drive',
};
const CAT_KEYS = ['operation', 'asin', 'marketplace', 'currentNode', 'currentNodeId', 'newNode', 'newNodeId', 'parentBrand', 'parentName', 'parentAsins', 'uploadTypes', 'destMarketplaces', 'driveLink'];
const CAT_MULTI = ['uploadTypes', 'destMarketplaces'];

// Brief CALI STRATEGICI
const SCOPE_ASIN = 'Uno o più ASIN';
const CALI_DOM = { destMarketplaces: 'kMarkets', scope: 'kScope', asin: 'kAsin', complaint: 'kComplaint' };
const CALI_LABELS = { destMarketplaces: 'Marketplace di destinazione', scope: 'Calo di', asin: 'ASIN in calo', complaint: 'Di cosa si lamenta il cliente?' };

// Brief ANALISI OPPORTUNITÀ
const OPP_DOM = { product: 'oProduct', destMarketplaces: 'oMarkets', price: 'oPrice', format: 'oFormat' };
const OPP_LABELS = { product: 'Prodotto da lanciare', destMarketplaces: 'Marketplace di destinazione', price: 'Prezzo di vendita', format: 'Formato / Quantità / Materiale' };

const TYPE_NAMES = ['performance', 'catalogo', 'cali', 'opportunita'];
const pick = (keys, multi, src = {}) => Object.fromEntries(keys.map((k) => [k, multi.includes(k) ? [...(src[k] || [])] : src[k] || '']));
const checked = (name) => [...document.querySelectorAll(`input[name="${name}"]:checked`)].map((b) => b.value);
const setChecked = (name, values) => {
  for (const box of document.querySelectorAll(`input[name="${name}"]`)) box.checked = values.includes(box.value);
};

const $ = (id) => document.getElementById(id);
const markets = () => [...document.querySelectorAll('input[name=marketplace]')];
const storage = (name) => ({
  get() { try { return sessionStorage.getItem(name) || ''; } catch { return ''; } },
  set(value) { try { value ? sessionStorage.setItem(name, value) : sessionStorage.removeItem(name); } catch { /* storage non disponibile */ } },
});
const keyStore = storage(KEY_STORAGE);
const typeStore = storage(TYPE_STORAGE);

let appKey = keyStore.get();
const urlType = new URLSearchParams(location.search).get('type');
let briefType = TYPE_NAMES.includes(urlType) ? urlType : TYPE_NAMES.includes(typeStore.get()) ? typeStore.get() : '';
let current = null; // { pageId, summary, brief, baseline: { <tipo>: valori caricati } }
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
  for (const [type, cfg] of Object.entries(TYPES)) $(cfg.section).hidden = type !== briefType;
  $('completeness').textContent = TYPES[briefType].data(current.brief)?.completeness || '';
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

const catalogSnapshot = (c) => pick(CAT_KEYS, CAT_MULTI, c);
const caliSnapshot = (c) => pick(Object.keys(CALI_DOM), ['destMarketplaces'], c);
const oppSnapshot = (o) => pick(Object.keys(OPP_DOM), ['destMarketplaces'], o);

function fillForm(brief) {
  current = {
    pageId: brief.pageId,
    summary: { id: brief.pageId, title: brief.title, client: brief.client, code: brief.code },
    brief,
    baseline: Object.fromEntries(Object.entries(TYPES).map(([type, cfg]) => [type, cfg.snapshot(cfg.data(brief) || {})])),
  };
  for (const [type, cfg] of Object.entries(TYPES)) cfg.fill(current.baseline[type]);
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

function fillPerformance(values) {
  for (const k of TEXT_FIELDS) $(k).value = values[k];
  for (const box of markets()) box.checked = values.marketplace.includes(box.value);
}

// --- Brief CATALOGO ---
function fillCatalog(c) {
  for (const radio of document.querySelectorAll('input[name=cOperation]')) radio.checked = radio.value === c.operation;
  $('cAsin').value = c.asin;
  $('cMarketplace').value = c.marketplace;
  $('cParentBrand').value = c.parentBrand;
  $('cParentName').value = c.parentName;
  $('cParentAsins').value = c.parentAsins;
  setChecked('cUTypes', c.uploadTypes);
  setChecked('cUMarkets', c.destMarketplaces);
  $('cUDrive').value = c.driveLink;
  pickers.currentNode.set(c.currentNodeId ? { id: c.currentNodeId, path: c.currentNode } : null);
  pickers.newNode.set(c.newNodeId ? { id: c.newNodeId, path: c.newNode } : null);
  showOperation(c.operation);
  loadTree(c.marketplace);
}

function showOperation(op) {
  $('asinField').hidden = op !== OP_NODE && op !== OP_UPLOAD;
  $('nodeFields').hidden = op !== OP_NODE;
  $('parentFields').hidden = op !== OP_PARENT;
  $('uploadFields').hidden = op !== OP_UPLOAD;
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

const radioValue = (name) => document.querySelector(`input[name="${name}"]:checked`)?.value || '';
const operationValue = () => radioValue('cOperation');
const parseAsins = (text) => [...new Set(text.toUpperCase().split(/[\s,;]+/).filter(Boolean))];

function asinError(text) {
  const tokens = parseAsins(text);
  const invalid = tokens.filter((t) => !/^[A-Z0-9]{10}$/.test(t));
  if (!tokens.length) return 'Inserisci almeno un ASIN.';
  return invalid.length ? `ASIN non valido: ${invalid.slice(0, 3).join(', ')} (servono 10 caratteri, es. B0FZTK766T).` : '';
}

// Mostra gli errori (chiave API → elemento del form) e porta il cursore sul primo campo da correggere.
function reportErrors(errors, dom) {
  clearErrors();
  const keys = Object.keys(errors).filter((k) => errors[k]);
  for (const k of keys) showError(dom[k], errors[k]);
  if (keys.length) focusField(dom[keys[0]]);
  return keys.length === 0;
}

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
  } else if (op === OP_UPLOAD) {
    values.asin = parseAsins($('cAsin').value).join('\n');
    values.uploadTypes = checked('cUTypes');
    values.destMarketplaces = checked('cUMarkets');
    values.driveLink = $('cUDrive').value.trim();
  }
  return values;
}

function validateCatalog(v) {
  const errors = {};
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
  if (v.operation === OP_UPLOAD) {
    errors.asin = asinError($('cAsin').value);
    if (!v.uploadTypes.length) errors.uploadTypes = 'Scegli almeno un tipo di caricamento.';
    if (!v.destMarketplaces.length) errors.destMarketplaces = 'Scegli almeno un marketplace di destinazione.';
    if (!v.driveLink) errors.driveLink = 'Incolla il link della cartella Drive.';
    else if (!/^https?:\/\/\S+\.\S+/i.test(v.driveLink)) errors.driveLink = 'Inserisci un link valido (es. https://drive.google.com/drive/folders/…).';
  }
  return reportErrors(errors, CAT_DOM);
}

// --- Brief CALI STRATEGICI ---
function fillCali(c) {
  setChecked('kMarkets', c.destMarketplaces);
  for (const radio of document.querySelectorAll('input[name=kScope]')) radio.checked = radio.value === c.scope;
  $('kAsin').value = c.asin;
  $('kComplaint').value = c.complaint;
  $('kAsinField').hidden = c.scope !== SCOPE_ASIN;
}

function collectCali() {
  const scope = radioValue('kScope');
  return {
    destMarketplaces: checked('kMarkets'),
    scope,
    asin: scope === SCOPE_ASIN ? parseAsins($('kAsin').value).join('\n') : '',
    complaint: $('kComplaint').value.trim(),
  };
}

function validateCali(v) {
  return reportErrors({
    destMarketplaces: v.destMarketplaces.length ? '' : 'Scegli almeno un marketplace di destinazione.',
    scope: v.scope ? '' : 'Indica se il calo riguarda uno o più ASIN o tutto l’account.',
    asin: v.scope === SCOPE_ASIN ? asinError($('kAsin').value) : '',
    complaint: v.complaint ? '' : 'Campo obbligatorio.',
  }, CALI_DOM);
}

// --- Brief ANALISI OPPORTUNITÀ ---
function fillOpp(o) {
  $('oProduct').value = o.product;
  setChecked('oMarkets', o.destMarketplaces);
  $('oPrice').value = o.price;
  $('oFormat').value = o.format;
}

function collectOpp() {
  return { product: $('oProduct').value.trim(), destMarketplaces: checked('oMarkets'), price: $('oPrice').value.trim(), format: $('oFormat').value.trim() };
}

function validateOpp(v) {
  return reportErrors({
    product: v.product ? '' : 'Campo obbligatorio.',
    destMarketplaces: v.destMarketplaces.length ? '' : 'Scegli almeno un marketplace di destinazione.',
    price: v.price ? '' : 'Campo obbligatorio.',
    format: v.format ? '' : 'Campo obbligatorio.',
  }, OPP_DOM);
}

// Registro dei tipi di brief: sezione del form, dove stanno i dati nella risposta, lettura/scrittura del form.
const TYPES = {
  performance: { section: 'perfFields', data: (b) => b, snapshot, fill: fillPerformance, collect, validate, dom: (k) => k, labels: LABELS },
  catalogo: {
    section: 'catalogFields', data: (b) => b.catalog, snapshot: catalogSnapshot, fill: fillCatalog,
    collect: collectCatalog, validate: validateCatalog, dom: (k) => CAT_DOM[k], labels: CAT_LABELS,
  },
  cali: {
    section: 'caliFields', data: (b) => b.cali, snapshot: caliSnapshot, fill: fillCali,
    collect: collectCali, validate: validateCali, dom: (k) => CALI_DOM[k], labels: CALI_LABELS,
  },
  opportunita: {
    section: 'oppFields', data: (b) => b.opportunita, snapshot: oppSnapshot, fill: fillOpp,
    collect: collectOpp, validate: validateOpp, dom: (k) => OPP_DOM[k], labels: OPP_LABELS,
  },
};

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
  const cfg = TYPES[type];
  const section = cfg.data(brief) || {};
  const data = { ...cfg.snapshot(section), type, code: brief.code, client: brief.client, title: brief.title, pageId, completeness: section.completeness || '' };
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
  for (const k of [...TEXT_FIELDS, 'marketplace', ...Object.values(CAT_DOM), ...Object.values(CALI_DOM), ...Object.values(OPP_DOM)]) showError(k, '');
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
  const cfg = TYPES[briefType];
  const values = cfg.collect();
  if (!cfg.validate(values)) {
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
      const theirs = cfg.data(err.data.brief);
      for (const k of err.data.conflicts) current.baseline[briefType][k] = theirs[k];
      const names = [...new Set(err.data.conflicts.map((k) => cfg.labels[k]))].join(', ');
      setStatus($('formStatus'), `${err.message} Campi: ${names}. Premi «Ricarica» per vedere la versione aggiornata, oppure salva di nuovo per sovrascriverla.`, 'warn');
    } else if (err.status === 400 && err.data.fields) {
      const keys = Object.keys(err.data.fields).map(cfg.dom).filter(Boolean);
      Object.entries(err.data.fields).forEach(([k, msg]) => cfg.dom(k) && showError(cfg.dom(k), msg));
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

$('caliFields').addEventListener('change', (e) => {
  if (e.target.name === 'kScope') $('kAsinField').hidden = e.target.value !== SCOPE_ASIN;
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
  markDirty(t.type === 'checkbox' || t.type === 'radio' ? t.name : t.id);
});
$('form').addEventListener('submit', save);

if (appKey) connect();
else $('key').focus();

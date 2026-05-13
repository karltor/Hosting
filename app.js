import { initializeApp } from "https://www.gstatic.com/firebasejs/12.13.0/firebase-app.js";
import {
  getAuth,
  signInAnonymously,
  onAuthStateChanged,
} from "https://www.gstatic.com/firebasejs/12.13.0/firebase-auth.js";
import {
  getFirestore,
  collection,
  doc,
  setDoc,
  updateDoc,
  deleteDoc,
  query,
  where,
  getDocs,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/12.13.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyAElhf7kYZbEo54MR3VO5nBBtipEw4IIVE",
  authDomain: "hosting-9c87a.firebaseapp.com",
  projectId: "hosting-9c87a",
  storageBucket: "hosting-9c87a.firebasestorage.app",
  messagingSenderId: "876600243013",
  appId: "1:876600243013:web:6d3e1cab364b097cecc42c",
  measurementId: "G-YCTWS09985",
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

const LIMITS = {
  maxFileBytes: 200 * 1024,
  maxTotalBytes: 500 * 1024,
  maxFilesPerSite: 10,
  maxSitesPerUser: 10,
};

const LS_KEY = "miniVard.sites";

// --- DOM ---
const userStatus = document.getElementById("userStatus");
const newSiteBtn = document.getElementById("newSiteBtn");
const sitesList = document.getElementById("sitesList");
const sitesEmpty = document.getElementById("sitesEmpty");

const siteModal = document.getElementById("siteModal");
const modalSiteName = document.getElementById("modalSiteName");
const modalClose = document.getElementById("modalClose");
const modalSave = document.getElementById("modalSave");
const modalMsg = document.getElementById("modalMsg");
const editorArea = document.getElementById("editorArea");
const fileTabs = document.getElementById("fileTabs");
const addFileBtn = document.getElementById("addFileBtn");
const filePicker = document.getElementById("filePicker");

let currentUser = null;

// Modal state
// { mode: 'new'|'edit', id?, name, files: {name: content}, active }
let state = null;

// --- Auth ---
onAuthStateChanged(auth, async (user) => {
  if (!user) {
    try {
      await signInAnonymously(auth);
    } catch (err) {
      userStatus.textContent = "Kunde inte logga in: " + err.message;
    }
    return;
  }
  currentUser = user;
  userStatus.textContent = "Inloggad anonymt";
  await refreshSites();
});

// --- Helpers ---
function setMsg(el, text, cls = "") {
  el.textContent = text;
  el.className = "msg " + cls;
}

function randomId(len = 7) {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  const arr = new Uint8Array(len);
  crypto.getRandomValues(arr);
  return Array.from(arr, (b) => chars[b % chars.length]).join("");
}

function byteLength(str) {
  return new Blob([str]).size;
}

function readFileText(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(r.error);
    r.readAsText(file);
  });
}

function getExt(name) {
  const i = name.lastIndexOf(".");
  return i >= 0 ? name.slice(i + 1).toLowerCase() : "";
}

function sanitizeFileName(name) {
  return name.replace(/[^\w.\-]/g, "_");
}

function guessExtFromContent(content) {
  const c = content.trim();
  if (!c) return null;
  if (/^<!doctype/i.test(c) || /^<html/i.test(c) || /<body[\s>]/i.test(c)) return "html";
  if (/^[\s\S]*\{[\s\S]*[a-z-]+\s*:\s*[^;]+;/i.test(c) && !/function|=>|const |let |var /.test(c)) return "css";
  return "js";
}

function autoName(existing, ext = null) {
  const has = (n) => Object.prototype.hasOwnProperty.call(existing, n);
  if (ext === "css" || ext == null) {
    if (!has("style.css")) return "style.css";
  }
  if (ext === "js" || ext == null) {
    if (!has("script.js")) return "script.js";
  }
  let i = 2;
  while (true) {
    const cssN = `style${i}.css`;
    const jsN = `script${i}.js`;
    if (ext !== "js" && !has(cssN)) return cssN;
    if (ext !== "css" && !has(jsN)) return jsN;
    i++;
  }
}

// --- LocalStorage cache ---
function cacheGet() {
  try { return JSON.parse(localStorage.getItem(LS_KEY) || "[]"); }
  catch { return []; }
}
function cacheSet(arr) { localStorage.setItem(LS_KEY, JSON.stringify(arr)); }
function cacheAdd(entry) {
  const cur = cacheGet().filter((x) => x.id !== entry.id);
  cur.unshift(entry);
  cacheSet(cur);
}
function cacheRemove(id) { cacheSet(cacheGet().filter((x) => x.id !== id)); }

// --- Site list ---
async function listUserSites() {
  if (!currentUser) return [];
  const q = query(collection(db, "sites"), where("ownerUid", "==", currentUser.uid));
  const snap = await getDocs(q);
  const out = [];
  snap.forEach((d) => out.push({ id: d.id, ...d.data() }));
  out.sort((a, b) => (b.updatedAt?.seconds || 0) - (a.updatedAt?.seconds || 0));
  return out;
}

function shareUrlFor(id) {
  return `${location.origin}${location.pathname.replace(/index\.html$/, "")}view.html#${id}`;
}

async function refreshSites() {
  sitesList.innerHTML = "";
  let sites;
  try {
    sites = await listUserSites();
  } catch (err) {
    sitesList.innerHTML = `<li class="empty">Kunde inte ladda: ${err.message}</li>`;
    return;
  }
  cacheSet(sites.map((s) => ({ id: s.id, name: s.name, updatedAt: Date.now() })));

  if (sites.length === 0) {
    sitesEmpty.hidden = false;
    return;
  }
  sitesEmpty.hidden = true;

  for (const s of sites) {
    const li = document.createElement("li");
    const url = shareUrlFor(s.id);
    const size = Math.round((s.sizeBytes || 0) / 1024 * 10) / 10;
    const count = Object.keys(s.files || {}).length;

    const meta = document.createElement("div");
    meta.className = "site-info";
    const nameEl = document.createElement("div");
    nameEl.className = "site-name";
    nameEl.textContent = s.name;
    const metaEl = document.createElement("div");
    metaEl.className = "site-meta";
    metaEl.textContent = `${size} KB • ${count} fil${count === 1 ? "" : "er"}`;
    meta.append(nameEl, metaEl);

    const actions = document.createElement("div");
    actions.className = "site-actions";

    const openBtn = document.createElement("button");
    openBtn.textContent = "Öppna";
    openBtn.addEventListener("click", () => window.open(url, "_blank", "noopener"));

    const copyBtn = document.createElement("button");
    copyBtn.className = "secondary";
    copyBtn.textContent = "Kopiera länk";
    copyBtn.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(url);
        copyBtn.textContent = "Kopierad!";
        setTimeout(() => (copyBtn.textContent = "Kopiera länk"), 1500);
      } catch { copyBtn.textContent = "Misslyckades"; }
    });

    const editBtn = document.createElement("button");
    editBtn.className = "secondary";
    editBtn.textContent = "Redigera";
    editBtn.addEventListener("click", () => openModalEdit(s));

    const delBtn = document.createElement("button");
    delBtn.className = "danger";
    delBtn.textContent = "Ta bort";
    delBtn.addEventListener("click", async () => {
      if (!confirm(`Ta bort "${s.name}"? Detta går inte att ångra.`)) return;
      try {
        await deleteDoc(doc(db, "sites", s.id));
        cacheRemove(s.id);
        await refreshSites();
      } catch (err) { alert("Kunde inte ta bort: " + err.message); }
    });

    actions.append(openBtn, copyBtn, editBtn, delBtn);
    li.append(meta, actions);
    sitesList.append(li);
  }
}

// --- Modal ---
function openModalNew() {
  state = {
    mode: "new",
    name: "",
    files: { "index.html": "" },
    active: null,
  };
  modalSiteName.value = "";
  modalSave.textContent = "Publicera";
  editorArea.value = "";
  selectFile("index.html");
  setMsg(modalMsg, "");
  siteModal.hidden = false;
  setTimeout(() => modalSiteName.focus(), 50);
}

function openModalEdit(site) {
  state = {
    mode: "edit",
    id: site.id,
    name: site.name,
    files: { ...site.files },
    active: null,
  };
  modalSiteName.value = site.name;
  modalSave.textContent = "Spara ändringar";
  editorArea.value = "";
  selectFile(Object.keys(state.files)[0] || "index.html");
  setMsg(modalMsg, "");
  siteModal.hidden = false;
}

function closeModal() {
  siteModal.hidden = true;
  state = null;
}

function syncActive() {
  if (state && state.active && state.files.hasOwnProperty(state.active)) {
    state.files[state.active] = editorArea.value;
  }
}

function selectFile(name) {
  if (!state.files.hasOwnProperty(name)) return;
  syncActive();
  state.active = name;
  editorArea.value = state.files[name] ?? "";
  renderTabs();
  editorArea.focus();
}

function renderTabs() {
  fileTabs.innerHTML = "";
  for (const name of Object.keys(state.files)) {
    const tab = document.createElement("div");
    tab.className = "tab" + (name === state.active ? " active" : "");
    tab.dataset.name = name;

    const nameSpan = document.createElement("span");
    nameSpan.className = "tab-name";
    nameSpan.textContent = name;
    nameSpan.title = "Dubbelklicka för att byta namn";
    nameSpan.addEventListener("click", () => selectFile(name));
    if (name !== "index.html") {
      nameSpan.addEventListener("dblclick", () => startRename(name, nameSpan));
    }

    tab.append(nameSpan);

    if (name !== "index.html") {
      const del = document.createElement("button");
      del.className = "tab-del";
      del.textContent = "✕";
      del.title = "Ta bort fil";
      del.addEventListener("click", (e) => {
        e.stopPropagation();
        deleteFile(name);
      });
      tab.append(del);
    }

    fileTabs.append(tab);
  }
}

function startRename(name, span) {
  const input = document.createElement("input");
  input.type = "text";
  input.className = "tab-rename";
  input.value = name;
  span.replaceWith(input);
  input.focus();
  input.select();

  const commit = () => {
    const raw = input.value.trim();
    if (!raw || raw === name) { renderTabs(); return; }
    const clean = sanitizeFileName(raw);
    const ext = getExt(clean);
    if (!["js", "css"].includes(ext)) {
      setMsg(modalMsg, `Filnamn måste sluta på .js eller .css.`, "err");
      renderTabs();
      return;
    }
    if (state.files.hasOwnProperty(clean)) {
      setMsg(modalMsg, `Filen ${clean} finns redan.`, "err");
      renderTabs();
      return;
    }
    // Rename preserving order
    const newFiles = {};
    for (const k of Object.keys(state.files)) {
      newFiles[k === name ? clean : k] = state.files[k];
    }
    state.files = newFiles;
    if (state.active === name) state.active = clean;
    setMsg(modalMsg, "");
    renderTabs();
  };
  input.addEventListener("blur", commit);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); input.blur(); }
    if (e.key === "Escape") { input.value = name; input.blur(); }
  });
}

function addFile(initialContent = "", hintExt = null) {
  if (Object.keys(state.files).length >= LIMITS.maxFilesPerSite) {
    setMsg(modalMsg, `Max ${LIMITS.maxFilesPerSite} filer per sida.`, "err");
    return null;
  }
  syncActive();
  const ext = hintExt || guessExtFromContent(initialContent);
  const name = autoName(state.files, ext === "css" || ext === "js" ? ext : null);
  state.files[name] = initialContent;
  state.active = name;
  renderTabs();
  editorArea.value = state.files[name];
  editorArea.focus();
  return name;
}

function deleteFile(name) {
  if (name === "index.html") return;
  if (!confirm(`Ta bort filen ${name}?`)) return;
  delete state.files[name];
  if (state.active === name) {
    state.active = Object.keys(state.files)[0];
    editorArea.value = state.files[state.active] ?? "";
  }
  renderTabs();
}

// --- File upload into modal ---
filePicker.addEventListener("change", async () => {
  for (const f of filePicker.files) {
    const text = await readFileText(f);
    const ext = getExt(f.name);
    if (ext === "html" || ext === "htm") {
      state.files["index.html"] = text;
      state.active = "index.html";
    } else if (ext === "js" || ext === "css") {
      const clean = sanitizeFileName(f.name);
      if (state.files.hasOwnProperty(clean)) {
        state.files[clean] = text;
      } else {
        if (Object.keys(state.files).length >= LIMITS.maxFilesPerSite) {
          setMsg(modalMsg, `Max ${LIMITS.maxFilesPerSite} filer per sida.`, "err");
          continue;
        }
        state.files[clean] = text;
      }
      state.active = clean;
    } else {
      setMsg(modalMsg, `Otillåten filtyp: ${f.name}`, "err");
      continue;
    }
  }
  editorArea.value = state.files[state.active] ?? "";
  renderTabs();
  filePicker.value = "";
});

// --- Save ---
async function saveModal() {
  if (!state) return;
  if (!currentUser) { setMsg(modalMsg, "Inte inloggad.", "err"); return; }
  syncActive();

  const name = modalSiteName.value.trim();
  if (!name) { setMsg(modalMsg, "Ge sidan ett namn först.", "err"); modalSiteName.focus(); return; }

  if (!state.files["index.html"] || !state.files["index.html"].trim()) {
    setMsg(modalMsg, "index.html är tom.", "err");
    return;
  }

  // Validate sizes
  let total = 0;
  for (const n of Object.keys(state.files)) {
    const sz = byteLength(state.files[n]);
    if (sz > LIMITS.maxFileBytes) {
      setMsg(modalMsg, `${n}: ${(sz / 1024).toFixed(1)} KB > ${LIMITS.maxFileBytes / 1024} KB.`, "err");
      return;
    }
    total += sz;
  }
  if (total > LIMITS.maxTotalBytes) {
    setMsg(modalMsg, `Totalt ${(total / 1024).toFixed(1)} KB > ${LIMITS.maxTotalBytes / 1024} KB.`, "err");
    return;
  }

  modalSave.disabled = true;
  try {
    if (state.mode === "new") {
      const existing = await listUserSites();
      if (existing.length >= LIMITS.maxSitesPerUser) {
        setMsg(modalMsg, `Max ${LIMITS.maxSitesPerUser} sidor. Ta bort en gammal först.`, "err");
        return;
      }
      const id = randomId();
      await setDoc(doc(db, "sites", id), {
        ownerUid: currentUser.uid,
        name,
        files: state.files,
        sizeBytes: total,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      cacheAdd({ id, name, updatedAt: Date.now() });
    } else {
      await updateDoc(doc(db, "sites", state.id), {
        name,
        files: state.files,
        sizeBytes: total,
        updatedAt: serverTimestamp(),
      });
    }
    closeModal();
    await refreshSites();
  } catch (err) {
    setMsg(modalMsg, "Kunde inte spara: " + err.message, "err");
  } finally {
    modalSave.disabled = false;
  }
}

// --- Events ---
newSiteBtn.addEventListener("click", openModalNew);
modalClose.addEventListener("click", closeModal);
modalSave.addEventListener("click", saveModal);
addFileBtn.addEventListener("click", () => addFile());
editorArea.addEventListener("input", () => {
  if (state) state.files[state.active] = editorArea.value;
});

// Close on backdrop click
siteModal.addEventListener("click", (e) => {
  if (e.target === siteModal) closeModal();
});
// Escape to close
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !siteModal.hidden) closeModal();
});

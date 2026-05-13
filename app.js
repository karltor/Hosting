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
const newSiteBtn = document.getElementById("newSiteBtn");
const siteCount = document.getElementById("siteCount");
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
// { mode: 'new'|'edit', id?, name, files: {name: content}, active, autoNamed: Set<string> }
let state = null;

// --- Auth ---
onAuthStateChanged(auth, async (user) => {
  if (!user) {
    try {
      await signInAnonymously(auth);
    } catch (err) {
      console.error("Auth-fel:", err);
    }
    return;
  }
  currentUser = user;
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

function sortFileNames(files) {
  const keys = Object.keys(files);
  const idx = keys.includes("index.html") ? ["index.html"] : [];
  const js  = keys.filter((n) => n !== "index.html" && getExt(n) === "js").sort();
  const css = keys.filter((n) => n !== "index.html" && getExt(n) === "css").sort();
  const other = keys.filter((n) => n !== "index.html" && getExt(n) !== "js" && getExt(n) !== "css").sort();
  return [...idx, ...js, ...css, ...other];
}

// Returns { missing, orphans } given a files map.
// `missing`: refs in index.html that point to non-existent files (excludes
// external URLs and data:/blob: URIs).
// `orphans`: non-index files that aren't referenced anywhere in index.html.
function analyzeRefs(files) {
  const html = files["index.html"] || "";
  const refs = new Set();
  try {
    const parser = new DOMParser();
    const docp = parser.parseFromString(html, "text/html");
    docp.querySelectorAll("script[src]").forEach((el) => {
      const ref = normalizeRef(el.getAttribute("src"));
      if (ref) refs.add(ref);
    });
    docp.querySelectorAll("link[href]").forEach((el) => {
      const rel = (el.getAttribute("rel") || "").toLowerCase();
      if (rel && rel !== "stylesheet") return;
      const ref = normalizeRef(el.getAttribute("href"));
      if (ref) refs.add(ref);
    });
  } catch { /* fall through with empty refs */ }

  const fileNames = Object.keys(files).filter((n) => n !== "index.html");
  const fileSet = new Set(fileNames);
  const missing = [...refs].filter((r) => !fileSet.has(r) && !fileSet.has(r.split("/").pop()));
  const orphans = fileNames.filter((n) => !refs.has(n));
  return { missing, orphans };
}

function normalizeRef(ref) {
  if (!ref) return null;
  if (/^([a-z]+:)?\/\//i.test(ref) || ref.startsWith("data:") || ref.startsWith("blob:")) return null;
  return ref.replace(/^\.?\//, "").split("?")[0].split("#")[0];
}

function guessExtFromContent(content) {
  const c = content.trim();
  if (!c) return null;
  if (/^<!doctype/i.test(c) || /^<html/i.test(c) || /<body[\s>]/i.test(c)) return "html";

  // JS keyword signals - both-sided word boundaries to avoid matching
  // CSS terms like "letter-spacing" (was caught by \blet) or "variable" (\bvar).
  if (/\b(function|const|let|var|return|class|import|export|typeof|new)\b/.test(c)) {
    return "js";
  }
  // Other strong JS signals
  if (/=>|console\.|document\.|window\.|\.querySelector|\.addEventListener/.test(c)) {
    return "js";
  }

  // CSS selector + declaration block
  if (/[#.@:\w*][\w\-,>+~*\s:()."'\[\]=]*\{\s*[a-z-]+\s*:\s*[^;{}]+;/i.test(c)) {
    return "css";
  }
  // @-rules
  if (/^\s*@(media|keyframes|import|font-face|supports|charset|page)\b/im.test(c)) {
    return "css";
  }
  return "js";
}

function autoName(existing, ext = null) {
  const has = (n) => Object.prototype.hasOwnProperty.call(existing, n);
  const first = ext === "css" ? ["style.css"] :
                ext === "js"  ? ["script.js"] :
                                ["style.css", "script.js"];
  for (const c of first) if (!has(c)) return c;
  let i = 2;
  while (i < 100) {
    if (ext !== "js" && !has(`style${i}.css`)) return `style${i}.css`;
    if (ext !== "css" && !has(`script${i}.js`)) return `script${i}.js`;
    i++;
  }
  return `fil${Date.now()}.${ext || "js"}`;
}

// --- Confirm modal (replaces window.confirm) ---
function confirmDialog({ title = "Bekräfta", message, confirmText = "OK", cancelText = "Avbryt", danger = false } = {}) {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "overlay confirm-overlay";
    const box = document.createElement("div");
    box.className = "confirm-box";
    const h = document.createElement("h3");
    h.textContent = title;
    const p = document.createElement("p");
    p.textContent = message;
    const actions = document.createElement("div");
    actions.className = "confirm-actions";
    const cancel = document.createElement("button");
    cancel.className = "secondary";
    cancel.textContent = cancelText;
    const ok = document.createElement("button");
    ok.className = danger ? "danger" : "";
    ok.textContent = confirmText;
    actions.append(cancel, ok);
    box.append(h, p, actions);
    overlay.append(box);
    document.body.append(overlay);

    const close = (val) => {
      document.removeEventListener("keydown", onKey);
      overlay.remove();
      resolve(val);
    };
    const onKey = (e) => {
      if (e.key === "Escape") close(false);
      if (e.key === "Enter") close(true);
    };
    cancel.addEventListener("click", () => close(false));
    ok.addEventListener("click", () => close(true));
    overlay.addEventListener("click", (e) => { if (e.target === overlay) close(false); });
    document.addEventListener("keydown", onKey);
    setTimeout(() => ok.focus(), 30);
  });
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

// Invalidate the viewer's per-site cache so the owner sees fresh content
function invalidateViewCache(id) {
  try { localStorage.removeItem("miniVard.view." + id); } catch {}
}

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

function updateSiteCount(n) {
  const max = LIMITS.maxSitesPerUser;
  siteCount.textContent = `${n} / ${max}`;
  siteCount.classList.toggle("warn", n >= max - 2 && n < max);
  siteCount.classList.toggle("full", n >= max);
  newSiteBtn.disabled = n >= max;
  newSiteBtn.title = n >= max
    ? `Du har nått gränsen ${max} sidor. Ta bort en gammal först.`
    : "";
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
  updateSiteCount(sites.length);

  if (sites.length === 0) {
    sitesEmpty.hidden = false;
    return;
  }
  sitesEmpty.hidden = true;

  for (const s of sites) {
    const li = document.createElement("li");
    const url = shareUrlFor(s.id);

    const meta = document.createElement("div");
    meta.className = "site-info";
    const nameEl = document.createElement("div");
    nameEl.className = "site-name";
    nameEl.textContent = s.name;
    meta.append(nameEl);

    const actions = document.createElement("div");
    actions.className = "site-actions";

    const openBtn = document.createElement("button");
    openBtn.textContent = "Öppna";
    openBtn.addEventListener("click", () => window.open(url, "_blank", "noopener"));

    const copyBtn = document.createElement("button");
    copyBtn.className = "secondary";
    copyBtn.textContent = "Kopiera";
    copyBtn.title = "Kopiera delningslänk";
    copyBtn.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(url);
        copyBtn.textContent = "Kopierad!";
        setTimeout(() => (copyBtn.textContent = "Kopiera"), 1500);
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
      const ok = await confirmDialog({
        title: "Ta bort sida",
        message: `Vill du verkligen ta bort "${s.name}"? Detta går inte att ångra.`,
        confirmText: "Ta bort",
        danger: true,
      });
      if (!ok) return;
      try {
        await deleteDoc(doc(db, "sites", s.id));
        cacheRemove(s.id);
        invalidateViewCache(s.id);
        await refreshSites();
      } catch (err) {
        await confirmDialog({ title: "Fel", message: "Kunde inte ta bort: " + err.message, confirmText: "OK", cancelText: "" });
      }
    });

    actions.append(openBtn, copyBtn, editBtn, delBtn);
    li.append(meta, actions);
    sitesList.append(li);
  }
}

// --- Modal ---
async function openModalNew() {
  // Re-check live count to avoid race (UI cached an old count)
  try {
    const existing = await listUserSites();
    if (existing.length >= LIMITS.maxSitesPerUser) {
      updateSiteCount(existing.length);
      await confirmDialog({
        title: "Sid-gränsen nådd",
        message: `Du har redan ${existing.length} av ${LIMITS.maxSitesPerUser} sidor. Ta bort en gammal innan du skapar en ny.`,
        confirmText: "OK",
        cancelText: "",
      });
      return;
    }
  } catch { /* fortsätt ändå om listning failar */ }

  state = {
    mode: "new",
    name: "",
    files: { "index.html": "" },
    active: null,
    autoNamed: new Set(),
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
    autoNamed: new Set(),
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
  for (const name of sortFileNames(state.files)) {
    const tab = document.createElement("div");
    tab.className = "tab" + (name === state.active ? " active" : "");
    tab.dataset.name = name;

    const nameSpan = document.createElement("span");
    nameSpan.className = "tab-name";
    nameSpan.textContent = name;
    nameSpan.addEventListener("click", () => selectFile(name));

    tab.append(nameSpan);

    if (name !== "index.html") {
      const rn = document.createElement("button");
      rn.className = "tab-icon tab-rn";
      rn.textContent = "✎";
      rn.title = "Byt namn";
      rn.addEventListener("click", (e) => {
        e.stopPropagation();
        startRename(name, nameSpan);
      });

      const del = document.createElement("button");
      del.className = "tab-icon tab-del";
      del.textContent = "✕";
      del.title = "Ta bort fil";
      del.addEventListener("click", (e) => {
        e.stopPropagation();
        deleteFile(name);
      });
      tab.append(rn, del);
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
    if (state.autoNamed.has(name)) state.autoNamed.delete(name);
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
  const ext = hintExt || (initialContent ? guessExtFromContent(initialContent) : null);
  const safeExt = ext === "css" || ext === "js" ? ext : null;
  const name = autoName(state.files, safeExt);
  state.files[name] = initialContent;
  state.autoNamed.add(name);
  state.active = name;
  renderTabs();
  editorArea.value = state.files[name];
  editorArea.focus();
  return name;
}

async function deleteFile(name) {
  if (name === "index.html") return;
  const ok = await confirmDialog({
    title: "Ta bort fil",
    message: `Vill du ta bort filen "${name}"?`,
    confirmText: "Ta bort",
    danger: true,
  });
  if (!ok) return;
  delete state.files[name];
  state.autoNamed.delete(name);
  if (state.active === name) {
    state.active = Object.keys(state.files)[0];
    editorArea.value = state.files[state.active] ?? "";
  }
  renderTabs();
}

// Auto-detect content type for auto-named files and rename if needed.
let relabelTimer = null;
function scheduleRelabel() {
  clearTimeout(relabelTimer);
  relabelTimer = setTimeout(relabelIfAuto, 400);
}
function relabelIfAuto() {
  if (!state) return;
  const cur = state.active;
  if (!cur || cur === "index.html") return;
  if (!state.autoNamed.has(cur)) return;
  const content = state.files[cur] || "";
  if (!content.trim()) return;
  const detected = guessExtFromContent(content);
  if (detected !== "css" && detected !== "js") return;
  if (getExt(cur) === detected) return;

  // Pretend current file isn't there so autoName picks a fresh one for this ext
  const without = { ...state.files };
  delete without[cur];
  const newName = autoName(without, detected);
  if (newName === cur || state.files.hasOwnProperty(newName)) return;

  const newFiles = {};
  for (const k of Object.keys(state.files)) {
    newFiles[k === cur ? newName : k] = state.files[k];
  }
  state.files = newFiles;
  state.autoNamed.delete(cur);
  state.autoNamed.add(newName);
  state.active = newName;
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

  // Reference check: warn if index.html refers to missing files or has orphan files
  const { missing, orphans } = analyzeRefs(state.files);
  if (missing.length || orphans.length) {
    const parts = [];
    if (missing.length) {
      parts.push("Index.html refererar till filer som inte finns:\n  • " + missing.join("\n  • "));
    }
    if (orphans.length) {
      parts.push("Dessa filer laddas inte av index.html:\n  • " + orphans.join("\n  • "));
    }
    parts.push("Lägg till eller byt namn på filer så att de stämmer med index.html, eller spara ändå.");
    const ok = await confirmDialog({
      title: "Filerna matchar inte index.html",
      message: parts.join("\n\n"),
      confirmText: "Spara ändå",
      cancelText: "Avbryt",
    });
    if (!ok) return;
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
      invalidateViewCache(state.id);
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
  if (!state || !state.active) return;
  state.files[state.active] = editorArea.value;
  scheduleRelabel();
});

// Close on backdrop click
siteModal.addEventListener("click", (e) => {
  if (e.target === siteModal) closeModal();
});
// Escape to close
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !siteModal.hidden) closeModal();
});

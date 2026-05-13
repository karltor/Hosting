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
  getDoc,
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

// --- Constants ---
export const LIMITS = {
  maxFileBytes: 200 * 1024,
  maxTotalBytes: 500 * 1024,
  maxFilesPerSite: 10,
  maxSitesPerUser: 10,
};

const ALLOWED_EXT = new Set(["html", "htm", "js", "css"]);
const LS_KEY = "miniVard.sites"; // cache of {id, name, updatedAt}

// --- DOM refs ---
const userStatus = document.getElementById("userStatus");
const uploadForm = document.getElementById("uploadForm");
const uploadMsg = document.getElementById("uploadMsg");
const siteNameInput = document.getElementById("siteName");
const indexFile = document.getElementById("indexFile");
const indexFileAdv = document.getElementById("indexFileAdv");
const extraFiles = document.getElementById("extraFiles");
const indexCode = document.getElementById("indexCode");
const indexCodeAdv = document.getElementById("indexCodeAdv");
const extraFilesList = document.getElementById("extraFilesList");
const addFileBtn = document.getElementById("addFileBtn");
const simpleFields = document.getElementById("simpleFields");
const advancedFields = document.getElementById("advancedFields");
const sitesList = document.getElementById("sitesList");
const sitesEmpty = document.getElementById("sitesEmpty");

const editorOverlay = document.getElementById("editorOverlay");
const editorTitle = document.getElementById("editorTitle");
const editorArea = document.getElementById("editorArea");
const fileTabs = document.getElementById("fileTabs");
const editorClose = document.getElementById("editorClose");
const editorSave = document.getElementById("editorSave");
const editorMsg = document.getElementById("editorMsg");

let currentUser = null;
let editingSite = null; // { id, name, files }
let activeFile = null;

// --- Mode toggle ---
document.querySelectorAll('input[name="mode"]').forEach((r) =>
  r.addEventListener("change", (e) => {
    const adv = e.target.value === "advanced";
    advancedFields.hidden = !adv;
    simpleFields.hidden = adv;
  })
);

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
  userStatus.textContent = "Inloggad anonymt • ID: " + user.uid.slice(0, 8);
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

// --- Extra-file rows (advanced mode) ---
function addExtraRow(name = "", content = "") {
  const row = document.createElement("div");
  row.className = "extra-row";
  row.innerHTML = `
    <div class="extra-row-head">
      <input type="text" class="extra-name" placeholder="filnamn.js" />
      <button type="button" class="icon-btn extra-remove" title="Ta bort">✕</button>
    </div>
    <textarea class="extra-content" rows="6" spellcheck="false" placeholder="// kod här"></textarea>
  `;
  row.querySelector(".extra-name").value = name;
  row.querySelector(".extra-content").value = content;
  row.querySelector(".extra-remove").addEventListener("click", () => row.remove());
  extraFilesList.append(row);
  return row;
}

addFileBtn?.addEventListener("click", () => addExtraRow());

// File-pickers fill the corresponding textarea/row
indexFile?.addEventListener("change", async () => {
  const f = indexFile.files[0];
  if (f) indexCode.value = await readFileText(f);
});
indexFileAdv?.addEventListener("change", async () => {
  const f = indexFileAdv.files[0];
  if (f) indexCodeAdv.value = await readFileText(f);
});
extraFiles?.addEventListener("change", async () => {
  for (const f of extraFiles.files) {
    addExtraRow(sanitizeFileName(f.name), await readFileText(f));
  }
  extraFiles.value = "";
});

// --- Upload validation ---
async function gatherFiles(mode) {
  const files = {};

  if (mode === "simple") {
    const html = indexCode.value.trim();
    if (!html) throw new Error("Klistra in din HTML eller välj en fil.");
    files["index.html"] = indexCode.value;
  } else {
    const html = indexCodeAdv.value.trim();
    if (!html) throw new Error("index.html är tom – klistra in HTML eller välj en fil.");
    files["index.html"] = indexCodeAdv.value;

    const rows = extraFilesList.querySelectorAll(".extra-row");
    for (const row of rows) {
      const rawName = row.querySelector(".extra-name").value.trim();
      const content = row.querySelector(".extra-content").value;
      if (!rawName && !content) continue;
      if (!rawName) throw new Error("En extra fil saknar namn.");
      const ext = getExt(rawName);
      if (!["js", "css"].includes(ext)) {
        throw new Error(`Otillåten filtyp: ${rawName}. Endast .js och .css tillåts.`);
      }
      const cleanName = sanitizeFileName(rawName);
      if (files[cleanName]) throw new Error(`Dubblettfil: ${cleanName}`);
      files[cleanName] = content;
    }
  }

  // Validate sizes
  const names = Object.keys(files);
  if (names.length > LIMITS.maxFilesPerSite) {
    throw new Error(`För många filer (max ${LIMITS.maxFilesPerSite}).`);
  }
  let total = 0;
  for (const n of names) {
    const sz = byteLength(files[n]);
    if (sz > LIMITS.maxFileBytes) {
      throw new Error(`Filen ${n} är ${(sz / 1024).toFixed(1)} KB – max ${LIMITS.maxFileBytes / 1024} KB per fil.`);
    }
    total += sz;
  }
  if (total > LIMITS.maxTotalBytes) {
    throw new Error(`Totalstorlek ${(total / 1024).toFixed(1)} KB överstiger gränsen ${LIMITS.maxTotalBytes / 1024} KB.`);
  }
  return { files, totalBytes: total };
}

// --- Submit ---
uploadForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  setMsg(uploadMsg, "");
  if (!currentUser) {
    setMsg(uploadMsg, "Inte inloggad ännu.", "err");
    return;
  }

  const mode = document.querySelector('input[name="mode"]:checked').value;
  const name = siteNameInput.value.trim();
  if (!name) {
    setMsg(uploadMsg, "Ange ett namn.", "err");
    return;
  }

  try {
    const existing = await listUserSites();
    if (existing.length >= LIMITS.maxSitesPerUser) {
      setMsg(uploadMsg, `Du har nått gränsen ${LIMITS.maxSitesPerUser} sidor. Ta bort en gammal först.`, "err");
      return;
    }

    const { files, totalBytes } = await gatherFiles(mode);
    const id = randomId();
    const payload = {
      ownerUid: currentUser.uid,
      name,
      files,
      sizeBytes: totalBytes,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    };
    await setDoc(doc(db, "sites", id), payload);
    cacheAdd({ id, name, updatedAt: Date.now() });
    setMsg(uploadMsg, "Publicerad! Delningslänk skapad.", "ok");
    uploadForm.reset();
    indexCode.value = "";
    indexCodeAdv.value = "";
    extraFilesList.innerHTML = "";
    advancedFields.hidden = true;
    simpleFields.hidden = false;
    await refreshSites();
  } catch (err) {
    console.error(err);
    setMsg(uploadMsg, err.message || "Något gick fel.", "err");
  }
});

// --- LocalStorage cache ---
function cacheGet() {
  try {
    return JSON.parse(localStorage.getItem(LS_KEY) || "[]");
  } catch {
    return [];
  }
}
function cacheSet(arr) {
  localStorage.setItem(LS_KEY, JSON.stringify(arr));
}
function cacheAdd(entry) {
  const cur = cacheGet().filter((x) => x.id !== entry.id);
  cur.unshift(entry);
  cacheSet(cur);
}
function cacheRemove(id) {
  cacheSet(cacheGet().filter((x) => x.id !== id));
}

// --- List sites ---
async function listUserSites() {
  if (!currentUser) return [];
  const q = query(collection(db, "sites"), where("ownerUid", "==", currentUser.uid));
  const snap = await getDocs(q);
  const out = [];
  snap.forEach((d) => out.push({ id: d.id, ...d.data() }));
  out.sort((a, b) => (b.updatedAt?.seconds || 0) - (a.updatedAt?.seconds || 0));
  return out;
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
    const shareUrl = `${location.origin}${location.pathname.replace(/index\.html$/, "")}view.html#${s.id}`;

    const left = document.createElement("div");
    left.innerHTML = `
      <div class="site-name"></div>
      <div class="site-meta">
        <span>ID: <code>${s.id}</code></span>
        <span>${Math.round((s.sizeBytes || 0) / 1024 * 10) / 10} KB</span>
        <span>${Object.keys(s.files || {}).length} fil(er)</span>
      </div>
      <a class="share-link" target="_blank" rel="noopener"></a>
    `;
    left.querySelector(".site-name").textContent = s.name;
    const link = left.querySelector(".share-link");
    link.href = shareUrl;
    link.textContent = shareUrl;

    const actions = document.createElement("div");
    actions.className = "site-actions";

    const openBtn = document.createElement("button");
    openBtn.textContent = "Öppna";
    openBtn.addEventListener("click", () => window.open(shareUrl, "_blank", "noopener"));

    const copyBtn = document.createElement("button");
    copyBtn.className = "secondary";
    copyBtn.textContent = "Kopiera länk";
    copyBtn.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(shareUrl);
        copyBtn.textContent = "Kopierad!";
        setTimeout(() => (copyBtn.textContent = "Kopiera länk"), 1500);
      } catch {
        copyBtn.textContent = "Misslyckades";
      }
    });

    const editBtn = document.createElement("button");
    editBtn.className = "secondary";
    editBtn.textContent = "Redigera";
    editBtn.addEventListener("click", () => openEditor(s));

    const delBtn = document.createElement("button");
    delBtn.className = "danger";
    delBtn.textContent = "Ta bort";
    delBtn.addEventListener("click", async () => {
      if (!confirm(`Ta bort "${s.name}"? Detta går inte att ångra.`)) return;
      try {
        await deleteDoc(doc(db, "sites", s.id));
        cacheRemove(s.id);
        await refreshSites();
      } catch (err) {
        alert("Kunde inte ta bort: " + err.message);
      }
    });

    actions.append(openBtn, copyBtn, editBtn, delBtn);
    li.append(left, actions);
    sitesList.append(li);
  }
}

// --- Editor ---
function openEditor(site) {
  editingSite = JSON.parse(JSON.stringify(site));
  // Strip non-file fields
  delete editingSite.ownerUid;
  delete editingSite.createdAt;
  delete editingSite.updatedAt;
  delete editingSite.sizeBytes;

  editorTitle.textContent = `Redigera: ${site.name}`;
  renderFileTabs();
  const first = Object.keys(editingSite.files)[0];
  selectFile(first);
  setMsg(editorMsg, "");
  editorOverlay.hidden = false;
}

function renderFileTabs() {
  fileTabs.innerHTML = "";
  for (const name of Object.keys(editingSite.files)) {
    const b = document.createElement("button");
    b.textContent = name;
    if (name === activeFile) b.classList.add("active");
    b.addEventListener("click", () => {
      // Save current buffer first
      if (activeFile) editingSite.files[activeFile] = editorArea.value;
      selectFile(name);
    });
    fileTabs.append(b);
  }
}

function selectFile(name) {
  activeFile = name;
  editorArea.value = editingSite.files[name] || "";
  renderFileTabs();
}

editorClose.addEventListener("click", () => {
  editorOverlay.hidden = true;
  editingSite = null;
  activeFile = null;
});

editorSave.addEventListener("click", async () => {
  if (!editingSite) return;
  if (activeFile) editingSite.files[activeFile] = editorArea.value;

  // Re-validate sizes
  let total = 0;
  for (const n of Object.keys(editingSite.files)) {
    const sz = byteLength(editingSite.files[n]);
    if (sz > LIMITS.maxFileBytes) {
      setMsg(editorMsg, `Filen ${n} är ${(sz / 1024).toFixed(1)} KB – max ${LIMITS.maxFileBytes / 1024} KB.`, "err");
      return;
    }
    total += sz;
  }
  if (total > LIMITS.maxTotalBytes) {
    setMsg(editorMsg, `Totalstorlek ${(total / 1024).toFixed(1)} KB > ${LIMITS.maxTotalBytes / 1024} KB.`, "err");
    return;
  }

  try {
    await updateDoc(doc(db, "sites", editingSite.id), {
      files: editingSite.files,
      sizeBytes: total,
      updatedAt: serverTimestamp(),
    });
    setMsg(editorMsg, "Sparat.", "ok");
    await refreshSites();
  } catch (err) {
    setMsg(editorMsg, "Kunde inte spara: " + err.message, "err");
  }
});

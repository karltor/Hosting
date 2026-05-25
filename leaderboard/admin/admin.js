import { initializeApp } from "https://www.gstatic.com/firebasejs/12.13.0/firebase-app.js";
import {
  getAuth,
  onAuthStateChanged,
  GoogleAuthProvider,
  signInWithPopup,
  signOut,
} from "https://www.gstatic.com/firebasejs/12.13.0/firebase-auth.js";
import {
  getFirestore,
  collection,
  doc,
  setDoc,
  deleteDoc,
  onSnapshot,
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

const ADMIN_EMAIL = "karl.tornered@nyamunken.se";

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

const signInBox = document.getElementById("signInBox");
const signInBtn = document.getElementById("signInBtn");
const signInMsg = document.getElementById("signInMsg");
const signOutBtn = document.getElementById("signOutBtn");
const adminPanel = document.getElementById("adminPanel");
const adminWho = document.getElementById("adminWho");
const publishedListEl = document.getElementById("publishedList");
const bannedListEl = document.getElementById("bannedList");

let publishedItems = [];
let bannedUids = [];

onAuthStateChanged(auth, (user) => {
  if (!user) {
    signInBox.hidden = false;
    adminPanel.hidden = true;
    signOutBtn.hidden = true;
    adminWho.hidden = true;
    return;
  }
  if (user.email !== ADMIN_EMAIL) {
    signInBox.hidden = false;
    adminPanel.hidden = true;
    signOutBtn.hidden = false;
    adminWho.hidden = true;
    signInMsg.textContent = `Inloggad som ${user.email} – ej admin. Logga ut.`;
    signInMsg.className = "msg err";
    return;
  }
  signInBox.hidden = true;
  adminPanel.hidden = false;
  signOutBtn.hidden = false;
  adminWho.hidden = false;
  adminWho.textContent = user.email;
  startListeners();
});

signInBtn.addEventListener("click", async () => {
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: "select_account" });
  try {
    signInMsg.textContent = "";
    await signInWithPopup(auth, provider);
  } catch (e) {
    signInMsg.textContent = "Fel: " + e.message;
    signInMsg.className = "msg err";
  }
});

signOutBtn.addEventListener("click", () => signOut(auth));

let unsubPub = null;
let unsubBan = null;
function startListeners() {
  if (unsubPub) unsubPub();
  unsubPub = onSnapshot(collection(db, "published"), (snap) => {
    publishedItems = [];
    snap.forEach((d) => publishedItems.push({ id: d.id, ...d.data() }));
    renderPublished();
  });

  if (unsubBan) unsubBan();
  unsubBan = onSnapshot(collection(db, "banned"), (snap) => {
    bannedUids = [];
    snap.forEach((d) => bannedUids.push({ uid: d.id, ...d.data() }));
    renderBanned();
    renderPublished();
  });
}

function isBanned(uid) {
  return bannedUids.some((b) => b.uid === uid);
}

function renderPublished() {
  publishedListEl.innerHTML = "";
  if (!publishedItems.length) {
    publishedListEl.innerHTML = '<p class="empty">Inga publicerade poster.</p>';
    return;
  }
  publishedItems.forEach((p) => {
    const row = document.createElement("div");
    row.className = "admin-row";

    const grow = document.createElement("div");
    grow.className = "grow";
    const title = document.createElement("div");
    title.className = "row-title";
    title.textContent = `${p.siteName || "(utan namn)"} – av ${p.authorName || "?"}`;
    const meta = document.createElement("div");
    meta.className = "row-meta";
    meta.textContent = `UID: ${p.ownerUid} • siteId: ${p.siteId} • ${p.description || ""}`;
    grow.append(title, meta);
    row.append(grow);

    const view = document.createElement("a");
    view.href = `../../view.html#${p.siteId}`;
    view.target = "_blank";
    view.textContent = "Visa";
    view.className = "secondary";
    view.style.cssText = "background:#e5e9f2;color:var(--text);padding:6px 12px;border-radius:5px;text-decoration:none;font-size:.85rem;";
    row.append(view);

    const banBtn = document.createElement("button");
    const banned = isBanned(p.ownerUid);
    banBtn.className = "ban-btn" + (banned ? " banned" : "");
    banBtn.textContent = banned ? "Bannlyst – avbanna" : "Banna författare";
    banBtn.addEventListener("click", async () => {
      if (banned) {
        if (!confirm(`Avbanna UID ${p.ownerUid}?`)) return;
        try { await deleteDoc(doc(db, "banned", p.ownerUid)); }
        catch (e) { alert("Fel: " + e.message); }
      } else {
        if (!confirm(`Banna UID ${p.ownerUid} (${p.authorName})? De kan inte längre publicera eller rösta.`)) return;
        try {
          await setDoc(doc(db, "banned", p.ownerUid), {
            authorName: p.authorName || "",
            bannedAt: new Date().toISOString(),
          });
        } catch (e) { alert("Fel: " + e.message); }
      }
    });
    row.append(banBtn);

    const del = document.createElement("button");
    del.className = "danger";
    del.textContent = "Ta bort post";
    del.addEventListener("click", async () => {
      if (!confirm(`Ta bort posten "${p.siteName}" från leaderboard?`)) return;
      try { await deleteDoc(doc(db, "published", p.id)); }
      catch (e) { alert("Fel: " + e.message); }
    });
    row.append(del);

    publishedListEl.append(row);
  });
}

function renderBanned() {
  bannedListEl.innerHTML = "";
  if (!bannedUids.length) {
    bannedListEl.innerHTML = '<p class="empty">Inga bannlysta.</p>';
    return;
  }
  bannedUids.forEach((b) => {
    const row = document.createElement("div");
    row.className = "admin-row";
    const grow = document.createElement("div");
    grow.className = "grow";
    const title = document.createElement("div");
    title.className = "row-title";
    title.textContent = b.authorName || "(okänd)";
    const meta = document.createElement("div");
    meta.className = "row-meta";
    meta.textContent = `UID: ${b.uid} • bannlyst ${b.bannedAt || ""}`;
    grow.append(title, meta);
    row.append(grow);

    const un = document.createElement("button");
    un.className = "secondary";
    un.textContent = "Avbanna";
    un.addEventListener("click", async () => {
      if (!confirm(`Avbanna ${b.authorName || b.uid}?`)) return;
      try { await deleteDoc(doc(db, "banned", b.uid)); }
      catch (e) { alert("Fel: " + e.message); }
    });
    row.append(un);
    bannedListEl.append(row);
  });
}

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
  getDoc,
  getDocs,
  addDoc,
  setDoc,
  deleteDoc,
  query,
  where,
  onSnapshot,
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

const boardTbody = document.getElementById("boardTbody");
const publishBtn = document.getElementById("publishBtn");
const publishModal = document.getElementById("publishModal");
const publishSiteSelect = document.getElementById("publishSiteSelect");
const publishAuthor = document.getElementById("publishAuthor");
const publishDesc = document.getElementById("publishDesc");
const publishOk = document.getElementById("publishOk");
const publishCancel = document.getElementById("publishCancel");
const publishMsg = document.getElementById("publishMsg");
const bannedNotice = document.getElementById("bannedNotice");

let currentUser = null;
let publishedItems = []; // [{id, ...data}]
let ratingsByPid = {};   // pid -> [{uid, value}]
let unsubPublished = null;
let ratingUnsubs = {}; // pid -> unsubscribe
let isBanned = false;

// Start published-listener immediately — reads are public so we don't need
// to wait for anonymous sign-in (which can take a couple of seconds).
startListeners();

// Kick off anonymous auth in the background so users can rate/publish soon.
signInAnonymously(auth).catch((e) => console.error(e));

onAuthStateChanged(auth, async (user) => {
  if (!user) return;
  currentUser = user;
  await checkBanned();
  render(); // re-render now that we know current user (for "Ta bort" buttons + own ratings)
});

async function checkBanned() {
  try {
    const snap = await getDoc(doc(db, "banned", currentUser.uid));
    isBanned = snap.exists();
    bannedNotice.hidden = !isBanned;
    publishBtn.disabled = isBanned;
  } catch (e) {
    isBanned = false;
  }
}

function startListeners() {
  if (unsubPublished) unsubPublished();
  unsubPublished = onSnapshot(collection(db, "published"), (snap) => {
    publishedItems = [];
    const seenIds = new Set();
    snap.forEach((d) => {
      publishedItems.push({ id: d.id, ...d.data() });
      seenIds.add(d.id);
    });
    // Subscribe to ratings for each new published doc
    for (const pid of seenIds) {
      if (ratingUnsubs[pid]) continue;
      ratingUnsubs[pid] = onSnapshot(collection(db, "published", pid, "ratings"), (rs) => {
        ratingsByPid[pid] = [];
        rs.forEach((r) => ratingsByPid[pid].push({ uid: r.id, value: r.data().value }));
        render();
      });
    }
    // Unsubscribe from removed
    for (const pid of Object.keys(ratingUnsubs)) {
      if (!seenIds.has(pid)) {
        ratingUnsubs[pid]();
        delete ratingUnsubs[pid];
        delete ratingsByPid[pid];
      }
    }
    render();
  });
}

function avgFor(pid) {
  const arr = ratingsByPid[pid] || [];
  if (!arr.length) return { avg: 0, count: 0 };
  const sum = arr.reduce((s, r) => s + (r.value || 0), 0);
  return { avg: sum / arr.length, count: arr.length };
}

function myRating(pid) {
  if (!currentUser) return 0;
  const arr = ratingsByPid[pid] || [];
  const r = arr.find((x) => x.uid === currentUser.uid);
  return r ? r.value : 0;
}

function buildStars(pid, avg, mine) {
  const wrap = document.createElement("div");
  wrap.className = "stars";
  for (let i = 1; i <= 5; i++) {
    const s = document.createElement("span");
    s.className = "star";
    s.textContent = "★";
    // Show user's rating if any; otherwise show rounded average
    const reference = mine || Math.round(avg);
    if (i <= reference) s.classList.add("filled");
    s.title = mine ? `Din betyg: ${mine}` : `Klicka för att ge ${i} stjärnor`;
    s.addEventListener("click", () => rate(pid, i));
    s.addEventListener("mouseenter", () => {
      [...wrap.children].forEach((c, idx) => {
        c.classList.toggle("filled", idx < i);
      });
    });
    s.addEventListener("mouseleave", () => {
      const ref = myRating(pid) || Math.round(avgFor(pid).avg);
      [...wrap.children].forEach((c, idx) => {
        c.classList.toggle("filled", idx < ref);
      });
    });
    wrap.append(s);
  }
  return wrap;
}

async function rate(pid, value) {
  if (!currentUser) return;
  if (isBanned) {
    alert("Du är bannlyst från att rösta.");
    return;
  }
  try {
    await setDoc(doc(db, "published", pid, "ratings", currentUser.uid), {
      value,
      ratedAt: serverTimestamp(),
    });
  } catch (e) {
    alert("Kunde inte spara betyg: " + e.message);
  }
}

function viewUrlFor(siteId) {
  // From /Hosting/leaderboard/ → ../view.html
  return `../view.html#${siteId}`;
}

function render() {
  // Sort: by avg desc, then count desc, then createdAt desc
  const items = publishedItems.map((p) => {
    const { avg, count } = avgFor(p.id);
    return { ...p, _avg: avg, _count: count };
  }).sort((a, b) => {
    if (b._avg !== a._avg) return b._avg - a._avg;
    if (b._count !== a._count) return b._count - a._count;
    return (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0);
  });

  boardTbody.innerHTML = "";
  if (!items.length) {
    boardTbody.innerHTML = '<tr><td colspan="7" class="empty">Inga publicerade sidor än. Bli först!</td></tr>';
    return;
  }

  items.forEach((p, idx) => {
    const tr = document.createElement("tr");
    if (idx === 0) tr.classList.add("top-1");
    else if (idx === 1) tr.classList.add("top-2");
    else if (idx === 2) tr.classList.add("top-3");

    const tdRank = document.createElement("td");
    tdRank.className = "col-rank";
    const rankBadge = document.createElement("span");
    rankBadge.className = "rank-badge";
    rankBadge.textContent = idx + 1;
    tdRank.append(rankBadge);

    const tdName = document.createElement("td");
    tdName.className = "col-name";
    tdName.textContent = p.siteName || "(utan namn)";

    const tdAuthor = document.createElement("td");
    tdAuthor.className = "col-author";
    tdAuthor.textContent = p.authorName || "okänd";

    const tdDesc = document.createElement("td");
    tdDesc.className = "col-desc";
    tdDesc.textContent = p.description || "";
    if (p.description) tdDesc.title = p.description;

    const tdRating = document.createElement("td");
    tdRating.className = "col-rating";
    const mine = myRating(p.id);
    tdRating.append(buildStars(p.id, p._avg, mine));

    const tdAvg = document.createElement("td");
    tdAvg.className = "col-avg";
    if (p._count > 0) {
      tdAvg.innerHTML = `<strong>${p._avg.toFixed(1)}</strong> <span class="muted">(${p._count})</span>`;
      if (mine) tdAvg.innerHTML += ` <span class="your">·${mine}★</span>`;
    } else {
      tdAvg.innerHTML = '<span class="muted">—</span>';
    }

    const tdActions = document.createElement("td");
    tdActions.className = "col-actions";
    const playLink = document.createElement("a");
    playLink.href = viewUrlFor(p.siteId);
    playLink.target = "_blank";
    playLink.rel = "noopener";
    playLink.className = "play-btn";
    playLink.textContent = "▶ Öppna";
    tdActions.append(playLink);

    if (currentUser && p.ownerUid === currentUser.uid) {
      const rm = document.createElement("button");
      rm.className = "remove-btn";
      rm.textContent = "✕";
      rm.title = "Avpublicera din post";
      rm.addEventListener("click", async () => {
        if (!confirm(`Avpublicera "${p.siteName}" från leaderboard?`)) return;
        try { await deleteDoc(doc(db, "published", p.id)); }
        catch (e) { alert("Kunde inte ta bort: " + e.message); }
      });
      tdActions.append(rm);
    }

    tr.append(tdRank, tdName, tdAuthor, tdDesc, tdRating, tdAvg, tdActions);
    boardTbody.append(tr);
  });
}

// --- Publish flow ---
publishBtn.addEventListener("click", openPublish);
publishCancel.addEventListener("click", () => { publishModal.hidden = true; });
publishModal.addEventListener("click", (e) => {
  if (e.target === publishModal) publishModal.hidden = true;
});

async function openPublish() {
  if (isBanned) return;
  if (!currentUser) return;
  publishMsg.textContent = "";
  publishAuthor.value = "";
  publishDesc.value = "";
  publishSiteSelect.innerHTML = '<option>Laddar dina sidor…</option>';
  publishModal.hidden = false;

  try {
    const q = query(collection(db, "sites"), where("ownerUid", "==", currentUser.uid));
    const snap = await getDocs(q);
    const mySites = [];
    snap.forEach((d) => mySites.push({ id: d.id, name: d.data().name || "(utan namn)" }));

    if (!mySites.length) {
      publishSiteSelect.innerHTML = '<option value="">(Du har inga sidor än)</option>';
      publishOk.disabled = true;
      publishMsg.textContent = "Skapa en sida först på huvudsidan.";
      publishMsg.className = "msg err";
      return;
    }

    // Exclude already-published siteIds owned by current user
    const myPublishedSiteIds = new Set(
      publishedItems.filter((p) => p.ownerUid === currentUser.uid).map((p) => p.siteId)
    );

    publishSiteSelect.innerHTML = "";
    let any = false;
    mySites.forEach((s) => {
      if (myPublishedSiteIds.has(s.id)) return;
      const opt = document.createElement("option");
      opt.value = s.id;
      opt.textContent = s.name;
      opt.dataset.name = s.name;
      publishSiteSelect.append(opt);
      any = true;
    });
    if (!any) {
      publishSiteSelect.innerHTML = '<option value="">(Alla dina sidor är redan publicerade)</option>';
      publishOk.disabled = true;
    } else {
      publishOk.disabled = false;
    }
  } catch (e) {
    publishSiteSelect.innerHTML = `<option value="">Fel: ${e.message}</option>`;
    publishOk.disabled = true;
  }
}

publishOk.addEventListener("click", async () => {
  const opt = publishSiteSelect.selectedOptions[0];
  const siteId = opt?.value;
  const siteName = opt?.dataset.name || "";
  const authorName = publishAuthor.value.trim();
  const description = publishDesc.value.trim();

  if (!siteId) { publishMsg.textContent = "Välj en sida."; publishMsg.className = "msg err"; return; }
  if (!authorName) { publishMsg.textContent = "Skriv ditt namn."; publishMsg.className = "msg err"; return; }

  publishOk.disabled = true;
  try {
    await addDoc(collection(db, "published"), {
      ownerUid: currentUser.uid,
      siteId,
      siteName,
      authorName,
      description,
      createdAt: serverTimestamp(),
    });
    publishModal.hidden = true;
  } catch (e) {
    publishMsg.textContent = "Kunde inte publicera: " + e.message;
    publishMsg.className = "msg err";
  } finally {
    publishOk.disabled = false;
  }
});

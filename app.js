// いけ散歩グルメマップ：左にお店のリスト、右に地図。データは Firebase（未設定ならブラウザ内）に保存。
(function () {
  "use strict";

  // ---------- ジャンル ----------
  // name は保存する値。追加・変更するときは firestore.rules は変更不要（文字数だけチェックしている）。
  const GENRES = [
    { name: "和食", label: "和食", color: "#c92a2a", examples: ["寿司", "天ぷら", "とんかつ", "定食", "うなぎ", "焼き鳥"] },
    { name: "洋食", label: "洋食・西洋料理", color: "#e8590c", examples: ["イタリアン", "フレンチ", "ハンバーグ", "ステーキ", "ピザ"] },
    { name: "中華", label: "中華", color: "#d4a000", examples: ["四川料理", "餃子", "点心", "町中華", "台湾料理"] },
    { name: "麺類", label: "麺類", color: "#2f9e44", examples: ["ラーメン", "つけ麺", "うどん", "そば", "油そば"] },
    { name: "カレー・エスニック", label: "カレー・エスニック", color: "#8b5a2b", examples: ["インド料理", "タイ料理", "ネパール料理", "スパイスカレー"] },
    { name: "韓国料理", label: "韓国料理", color: "#d6336c", examples: ["焼肉", "サムギョプサル", "チゲ", "ビビンバ"] },
    { name: "カフェ・スイーツ", label: "カフェ・スイーツ", color: "#7950f2", examples: ["喫茶店", "パンケーキ", "ケーキ", "甘味処", "ベーカリー"] },
    { name: "その他", label: "その他", color: "#1c7ed6", examples: ["メキシコ料理", "中東料理", "ベトナム料理", "ジャンル不明など"] },
  ];
  const NO_GENRE_COLOR = "#868e96";
  const genreOf = (name) => GENRES.find((g) => g.name === name);

  // 以前の自由記入のジャンル（「ラーメン」など）も、8種類のどれかに読み替える
  function normalizeGenre(raw) {
    const v = (raw || "").trim();
    if (!v) return "";
    if (genreOf(v)) return v;
    const hit = GENRES.find((g) => g.label === v || g.examples.some((ex) => v.includes(ex) || ex.includes(v)));
    return hit ? hit.name : "その他";
  }

  // ---------- データ保存先 ----------
  // Firebase の設定があれば Firestore、なければ localStorage（お試しモード）。
  const cfg = window.FIREBASE_CONFIG || {};
  const useFirebase = Boolean(cfg.apiKey && cfg.projectId && window.firebase);

  function firebaseStore() {
    firebase.initializeApp(cfg);
    const col = firebase.firestore().collection("restaurants");
    const now = () => firebase.firestore.FieldValue.serverTimestamp();
    return {
      subscribe(cb, onError) {
        return col.orderBy("createdAt", "desc").onSnapshot(
          (snap) => cb(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
          onError
        );
      },
      add: (data) => col.add({ ...data, createdAt: now(), updatedAt: now() }),
      update: (id, data) => col.doc(id).update({ ...data, updatedAt: now() }),
      remove: (id) => col.doc(id).delete(),
    };
  }

  function localStore() {
    const KEY = "shop-map-demo";
    let items;
    try { items = JSON.parse(localStorage.getItem(KEY)); } catch (e) { items = null; }
    if (!Array.isArray(items)) items = sampleShops();
    let listener = () => {};
    const save = () => {
      try { localStorage.setItem(KEY, JSON.stringify(items)); } catch (e) { /* 保存できなくても表示は続ける */ }
      listener(items.slice());
    };
    return {
      subscribe(cb) { listener = cb; cb(items.slice()); return () => {}; },
      async add(data) { items.unshift({ ...data, id: "l" + Date.now(), createdAt: Date.now() }); save(); },
      async update(id, data) { items = items.map((s) => (s.id === id ? { ...s, ...data } : s)); save(); },
      async remove(id) { items = items.filter((s) => s.id !== id); save(); },
    };
  }

  // お試しモード用のサンプル（実在店の情報ではありません）
  function sampleShops() {
    return [
      { id: "s1", name: "（サンプル）札幌ラーメン横丁の店", genre: "ラーメン", address: "北海道札幌市中央区南5条西3丁目", lat: 43.0548, lng: 141.3536, memo: "サンプルデータです。編集や削除を試してみてください。", url: "" },
      { id: "s2", name: "（サンプル）浅草の天ぷら屋", genre: "和食", address: "東京都台東区浅草1丁目", lat: 35.7118, lng: 139.7966, memo: "", url: "" },
      { id: "s3", name: "（サンプル）道頓堀のたこ焼き", genre: "粉もん", address: "大阪府大阪市中央区道頓堀1丁目", lat: 34.6687, lng: 135.5013, memo: "", url: "" },
      { id: "s4", name: "（サンプル）中洲の屋台", genre: "屋台", address: "福岡県福岡市博多区中洲1丁目", lat: 33.5916, lng: 130.4066, memo: "", url: "" },
    ];
  }

  const store = useFirebase ? firebaseStore() : localStore();

  // ---------- 画面の部品 ----------
  const $ = (id) => document.getElementById(id);
  const els = {
    mode: $("mode"), q: $("q"), list: $("list"), empty: $("empty"), count: $("count"),
    addBtn: $("add-btn"), mapWrap: document.querySelector(".map-wrap"), pickBanner: $("pick-banner"),
    dlg: $("dlg"), form: $("form"), dlgTitle: $("dlg-title"), name: $("f-name"), genre: $("f-genre"),
    address: $("f-address"), memo: $("f-memo"), url: $("f-url"), geoBtn: $("geo-btn"), pickBtn: $("pick-btn"),
    loc: document.querySelector(".loc"), locText: $("loc-text"), geoResults: $("geo-results"),
    err: $("err"), delBtn: $("del-btn"), cancelBtn: $("cancel-btn"), saveBtn: $("save-btn"),
    hideVisited: $("hide-visited"), visited: $("f-visited"), visitedAt: $("f-visited-at"),
    genreFilter: $("genre-filter"), genreHint: $("genre-hint"), legendList: $("legend-list"), author: $("f-author"),
  };

  // ジャンルの選択肢・説明（凡例）を作る
  for (const sel of [els.genre, els.genreFilter]) {
    for (const g of GENRES) sel.append(new Option(g.label, g.name));
  }
  els.legendList.replaceChildren(...GENRES.map((g) => {
    const li = document.createElement("li");
    li.innerHTML = `<span class="dot" style="background:${g.color}"></span><span><b>${g.label}</b><br><small>${g.examples.join("、")}</small></span>`;
    return li;
  }));
  function updateGenreHint() {
    const g = genreOf(els.genre.value);
    els.genreHint.textContent = g ? `例：${g.examples.join("、")}` : "";
  }
  els.genre.addEventListener("change", updateGenreHint);

  if (useFirebase) {
    els.mode.textContent = "リンクを知っている人と共有中";
  } else {
    els.mode.textContent = "お試しモード：データはこのブラウザの中だけに保存されます";
    els.mode.classList.add("demo");
  }

  // ---------- 地図 ----------
  const map = L.map("map", { zoomControl: true }).setView([36.2, 138.25], 5); // 日本全体
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  }).addTo(map);

  // ピンの色はジャンル色。訪問済みは半透明にして中に ✓ を入れる
  function pinIcon(active, visited, genre) {
    const fill = genreOf(genre)?.color || NO_GENRE_COLOR;
    const size = active ? 38 : 30;
    const center = visited
      ? `<path d="M8 11.5l3 3 5-6" stroke="#fff" stroke-width="2.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`
      : `<circle cx="12" cy="11.5" r="4.5" fill="#fff"/>`;
    return L.divIcon({
      className: "pin" + (visited ? " pin-visited" : ""),
      iconSize: [size, size * 1.33],
      iconAnchor: [size / 2, size * 1.33],
      popupAnchor: [0, -size * 1.2],
      html: `<svg width="${size}" height="${size * 1.33}" viewBox="0 0 24 32"><path d="M12 0C5.4 0 0 5.3 0 11.8 0 20.6 12 32 12 32s12-11.4 12-20.2C24 5.3 18.6 0 12 0z" fill="${fill}" stroke="#fff" stroke-width="1"/>${center}</svg>`,
    });
  }

  // ---------- 状態 ----------
  let shops = [];
  let activeId = null;
  let editingId = null;
  let draftLoc = null;     // フォーム中の位置 {lat,lng}
  let draftMarker = null;
  let picking = false;
  let firstFit = true;
  const markers = new Map();

  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const safeUrl = (u) => (/^https?:\/\//i.test(u || "") ? u : "");
  const hasLoc = (s) => Number.isFinite(s.lat) && Number.isFinite(s.lng);
  // 古いデータには visited が無いので「未訪問」として扱う
  const isVisited = (s) => s.visited === true;
  const today = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  };
  const fmtDate = (v) => (v ? v.replace(/^(\d{4})-(\d{2})-(\d{2})$/, (_, y, m, d) => `${y}/${+m}/${+d}`) : "");

  // 「訪問済みを隠す」はこのブラウザに覚えておく
  try { els.hideVisited.checked = localStorage.getItem("hide-visited") === "1"; } catch (e) { /* 覚えられなくても動く */ }

  function filtered() {
    const q = els.q.value.trim().toLowerCase();
    const g = els.genreFilter.value;
    return shops.filter((s) =>
      !(els.hideVisited.checked && isVisited(s)) &&
      (!g || normalizeGenre(s.genre) === g) &&
      (!q || [s.name, s.genre, s.address, s.memo, s.author].some((v) => (v || "").toLowerCase().includes(q)))
    );
  }

  function genreChip(s) {
    const g = genreOf(normalizeGenre(s.genre));
    if (!g) return "";
    return `<span class="item-genre"><span class="dot" style="background:${g.color}"></span>${esc(g.name)}</span>`;
  }

  function popupHtml(s) {
    const url = safeUrl(s.url);
    const g = normalizeGenre(s.genre);
    return `<div class="pop-name">${esc(s.name)}</div>` +
      (g ? `<div class="pop-genre">${esc(g)}</div>` : "") +
      (s.author ? `<div class="pop-genre">記入：${esc(s.author)}</div>` : "") +
      (isVisited(s) ? `<div class="pop-genre">訪問済み${s.visitedAt ? "（" + esc(fmtDate(s.visitedAt)) + "）" : ""}</div>` : "") +
      (s.address ? `<div>${esc(s.address)}</div>` : "") +
      (url ? `<div><a href="${esc(url)}" target="_blank" rel="noopener">ウェブサイト</a></div>` : "") +
      `<div><a href="https://www.google.com/maps/search/?api=1&query=${s.lat},${s.lng}" target="_blank" rel="noopener">Googleマップで開く</a></div>`;
  }

  function render() {
    const list = filtered();
    const visible = new Set(list.map((s) => s.id));

    // リスト
    els.list.replaceChildren(...list.map((s) => {
      const li = document.createElement("li");
      const v = isVisited(s);
      li.className = "item" + (s.id === activeId ? " active" : "") + (v ? " visited" : "");
      li.tabIndex = 0;
      li.dataset.id = s.id;
      li.innerHTML =
        `<div class="item-top">` +
        `<input type="checkbox" class="visit-check" data-visit="${esc(s.id)}" ${v ? "checked" : ""} aria-label="訪問済み" title="訪問済み">` +
        `<span class="item-name">${esc(s.name)}</span>` +
        genreChip(s) + `</div>` +
        (v ? `<label class="item-visited">訪問日 <input type="date" data-visit-date="${esc(s.id)}" value="${esc(s.visitedAt || "")}"></label>` : "") +
        (s.memo ? `<div class="item-memo">${esc(s.memo)}</div>` : "") +
        (hasLoc(s) ? "" : `<div class="item-nopin">位置が未設定です</div>`) +
        `<div class="item-foot"><button class="btn link item-edit" type="button" data-edit="${esc(s.id)}">編集</button></div>`;
      return li;
    }));
    els.empty.hidden = shops.length > 0;
    els.count.textContent = shops.length ? (list.length === shops.length ? `${shops.length} 件` : `${list.length} / ${shops.length} 件`) : "";

    // ピン
    for (const [id, m] of markers) {
      if (!shops.some((s) => s.id === id && hasLoc(s))) { m.remove(); markers.delete(id); }
    }
    for (const s of shops) {
      if (!hasLoc(s)) continue;
      let m = markers.get(s.id);
      if (!m) {
        m = L.marker([s.lat, s.lng]).on("click", () => select(s.id, false));
        markers.set(s.id, m);
      }
      m.setLatLng([s.lat, s.lng]).setIcon(pinIcon(s.id === activeId, isVisited(s), normalizeGenre(s.genre))).setZIndexOffset(s.id === activeId ? 1000 : 0);
      m.bindPopup(popupHtml(s));
      if (visible.has(s.id)) m.addTo(map); else m.remove();
    }
  }

  function fitAll() {
    map.invalidateSize(); // 起動直後は地図の大きさが確定していないことがある
    const pts = filtered().filter(hasLoc).map((s) => [s.lat, s.lng]);
    if (pts.length === 1) map.setView(pts[0], 15);
    else if (pts.length > 1) map.fitBounds(pts, { padding: [40, 40], maxZoom: 15 });
  }

  function select(id, fromList) {
    activeId = id;
    render();
    const s = shops.find((x) => x.id === id);
    // ピンを押したときは地図側が吹き出しを開くので、ここで開くのはリストから選んだときだけ
    // （両方で開くと、地図側が「開いている→閉じる」と判断して消えてしまう）
    if (s && hasLoc(s) && fromList) {
      map.flyTo([s.lat, s.lng], Math.max(map.getZoom(), 15), { duration: 0.6 });
      markers.get(id)?.openPopup();
    }
    if (!fromList) els.list.querySelector(`[data-id="${CSS.escape(id)}"]`)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }

  // 訪問済みチェック：チェックしたら今日の日付を入れる。外したら日付も消す
  els.list.addEventListener("change", async (e) => {
    const t = e.target;
    try {
      if (t.dataset.visit) {
        await store.update(t.dataset.visit, t.checked ? { visited: true, visitedAt: today() } : { visited: false, visitedAt: null });
      } else if (t.dataset.visitDate) {
        await store.update(t.dataset.visitDate, { visitedAt: t.value || null });
      }
    } catch (err) {
      alertBar("保存できませんでした。通信状態を確認してください。");
      render();
    }
  });

  function alertBar(msg) {
    els.mode.textContent = msg;
    els.mode.classList.add("demo");
  }

  els.list.addEventListener("click", (e) => {
    if (e.target.closest(".visit-check, .item-visited")) return; // チェックや日付の操作では地図を動かさない
    const edit = e.target.closest("[data-edit]");
    if (edit) { openForm(shops.find((s) => s.id === edit.dataset.edit)); return; }
    const li = e.target.closest(".item");
    if (li) select(li.dataset.id, true);
  });
  els.list.addEventListener("keydown", (e) => {
    const li = e.target.closest(".item");
    if (li && e.target === li && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); select(li.dataset.id, true); }
  });
  els.q.addEventListener("input", () => { render(); fitAll(); });
  els.genreFilter.addEventListener("change", () => { render(); fitAll(); });
  els.hideVisited.addEventListener("change", () => {
    try { localStorage.setItem("hide-visited", els.hideVisited.checked ? "1" : "0"); } catch (e) { /* 覚えられなくても動く */ }
    render();
  });

  // ---------- 追加・編集フォーム ----------
  function setDraftLoc(loc) {
    draftLoc = loc;
    els.loc.classList.toggle("set", !!loc);
    els.locText.textContent = loc ? `位置：${loc.lat.toFixed(5)}, ${loc.lng.toFixed(5)}` : "位置：未設定";
    if (draftMarker) { draftMarker.remove(); draftMarker = null; }
    if (loc) draftMarker = L.marker([loc.lat, loc.lng], { icon: pinIcon(true, false, els.genre.value), opacity: 0.7 }).addTo(map);
  }

  function openForm(shop) {
    editingId = shop ? shop.id : null;
    els.dlgTitle.textContent = shop ? "お店を編集" : "お店を追加";
    els.name.value = shop?.name || "";
    els.genre.value = normalizeGenre(shop?.genre);
    updateGenreHint();
    // 記入者名：編集時は元の記入者、新規はこのブラウザで前回使った名前
    let lastAuthor = "";
    try { lastAuthor = localStorage.getItem("author-name") || ""; } catch (e) { /* 覚えられなくても動く */ }
    els.author.value = shop ? (shop.author || "") : lastAuthor;
    els.address.value = shop?.address || "";
    els.memo.value = shop?.memo || "";
    els.url.value = shop?.url || "";
    els.visited.checked = shop ? isVisited(shop) : false;
    els.visitedAt.value = shop?.visitedAt || "";
    els.visitedAt.disabled = !els.visited.checked;
    els.delBtn.hidden = !shop;
    els.delBtn.textContent = "削除";
    delete els.delBtn.dataset.confirm;
    els.err.hidden = true;
    els.geoResults.replaceChildren();
    setDraftLoc(shop && hasLoc(shop) ? { lat: shop.lat, lng: shop.lng } : null);
    els.dlg.showModal();
    els.name.focus();
  }

  function closeForm() {
    els.dlg.close();
    setDraftLoc(null);
    editingId = null;
  }

  function showErr(msg) { els.err.textContent = msg; els.err.hidden = false; }

  els.visited.addEventListener("change", () => {
    els.visitedAt.disabled = !els.visited.checked;
    if (els.visited.checked && !els.visitedAt.value) els.visitedAt.value = today();
  });

  els.addBtn.addEventListener("click", () => openForm(null));
  els.cancelBtn.addEventListener("click", closeForm);
  els.dlg.addEventListener("cancel", (e) => { e.preventDefault(); closeForm(); });

  // 住所から位置を探す。日本の番地に強い国土地理院を先に使い、
  // 見つからなければ OpenStreetMap（駅名・施設名など）で探す。
  async function searchGsi(q) {
    const res = await fetch(`https://msearch.gsi.go.jp/address-search/AddressSearch?q=${encodeURIComponent(q)}`);
    const data = await res.json();
    return data.slice(0, 5).map((r) => ({ label: r.properties.title, lat: r.geometry.coordinates[1], lng: r.geometry.coordinates[0] }));
  }
  async function searchOsm(q) {
    const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=5&accept-language=ja&q=${encodeURIComponent(q)}`);
    const data = await res.json();
    return data.map((r) => ({ label: r.display_name, lat: +r.lat, lng: +r.lon }));
  }
  async function geocode(q) {
    let hits = [];
    try { hits = await searchGsi(q); } catch (e) { /* 次の方法で探す */ }
    if (!hits.length) hits = await searchOsm(q);
    return hits;
  }

  function applyHit(h) {
    setDraftLoc({ lat: h.lat, lng: h.lng });
    els.locText.textContent = `位置：${h.label}`;
    map.setView([h.lat, h.lng], 17);
    els.geoResults.replaceChildren();
  }

  els.geoBtn.addEventListener("click", async () => {
    const q = els.address.value.trim() || els.name.value.trim();
    if (!q) { showErr("住所か店名を入力してから検索してください。"); return; }
    els.err.hidden = true;
    els.geoBtn.disabled = true;
    els.geoBtn.textContent = "検索中…";
    try {
      const hits = await geocode(q);
      if (!hits.length) {
        showErr("見つかりませんでした。住所を確認するか、「地図で指定」を使ってください。");
        els.geoResults.replaceChildren();
      } else if (hits.length === 1) {
        applyHit(hits[0]); // 1件だけならそのまま決定
      } else {
        els.geoResults.replaceChildren(...hits.map((h) => {
          const li = document.createElement("li");
          const b = document.createElement("button");
          b.type = "button"; b.className = "btn"; b.textContent = h.label;
          b.addEventListener("click", () => applyHit(h));
          li.append(b);
          return li;
        }));
      }
    } catch (e) {
      showErr("位置の検索に失敗しました。「地図で指定」を使ってください。");
    } finally {
      els.geoBtn.disabled = false;
      els.geoBtn.textContent = "位置を検索";
    }
  });

  // 地図をクリックして位置を指定
  els.pickBtn.addEventListener("click", () => {
    picking = true;
    els.dlg.close();
    els.mapWrap.classList.add("picking");
    els.pickBanner.hidden = false;
    if (draftLoc) map.setView([draftLoc.lat, draftLoc.lng], Math.max(map.getZoom(), 15));
  });
  map.on("click", (e) => {
    if (!picking) return;
    picking = false;
    els.mapWrap.classList.remove("picking");
    els.pickBanner.hidden = true;
    setDraftLoc({ lat: e.latlng.lat, lng: e.latlng.lng });
    els.dlg.showModal();
  });

  els.form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const name = els.name.value.trim();
    if (!name) { showErr("店名を入力してください。"); return; }
    const url = els.url.value.trim();
    if (url && !safeUrl(url)) { showErr("URL は https:// から始まる形で入力してください。"); return; }
    const data = {
      name,
      genre: els.genre.value,
      author: els.author.value.trim(),
      address: els.address.value.trim(),
      memo: els.memo.value.trim(),
      url,
      lat: draftLoc ? draftLoc.lat : null,
      lng: draftLoc ? draftLoc.lng : null,
      visited: els.visited.checked,
      visitedAt: els.visited.checked ? (els.visitedAt.value || null) : null,
    };
    els.saveBtn.disabled = true;
    try {
      if (editingId) await store.update(editingId, data);
      else await store.add(data);
      if (data.author) { try { localStorage.setItem("author-name", data.author); } catch (e) { /* 覚えられなくても動く */ } }
      closeForm();
      if (data.lat != null) map.flyTo([data.lat, data.lng], Math.max(map.getZoom(), 15), { duration: 0.6 });
    } catch (err) {
      showErr("保存できませんでした。通信状態を確認してもう一度お試しください。");
    } finally {
      els.saveBtn.disabled = false;
    }
  });

  // 削除は2回押しで確定（誤操作防止）
  els.delBtn.addEventListener("click", async () => {
    if (!els.delBtn.dataset.confirm) {
      els.delBtn.dataset.confirm = "1";
      els.delBtn.textContent = "本当に削除する";
      return;
    }
    try {
      await store.remove(editingId);
      if (activeId === editingId) activeId = null;
      closeForm();
    } catch (err) {
      showErr("削除できませんでした。");
    }
  });

  // ---------- 起動 ----------
  store.subscribe(
    (items) => {
      shops = items;
      render();
      if (firstFit && shops.length) { firstFit = false; requestAnimationFrame(fitAll); }
    },
    () => { els.mode.textContent = "データを読み込めませんでした。Firebase の設定を確認してください。"; els.mode.classList.add("demo"); }
  );
})();

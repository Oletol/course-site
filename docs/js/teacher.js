// Teacher's Edition: unit preview with keys, unit access per group, releasing results,
// manual assessment of open answers, content import, groups and students.
import {
  auth, db, onAuthStateChanged, signInWithEmailAndPassword, sendPasswordResetEmail, signOut,
  doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc, onSnapshot, collection, query, where, orderBy,
  writeBatch, arrayUnion, arrayRemove, serverTimestamp, deleteField,
} from "./fb.js?v=20261115d";
import { courseTitle, loadSettings, saveSettings, CS } from "./settings.js?v=20261115d";
import { LANGS, FIRST_LANGS } from "./course-state.js?v=20261115d";
import {
  esc, renderBlocks, renderExercise, exercisesOf, isAuto, gradeAuto, buildResult, keyText, norm,
  fmtTime, friendlyError, authFormHTML, wireAuthForm, subId, KIND_LABEL, isTeacherChecked, gradeExercise, wireFlashcards, isManual,
  isCorrect, readInput, doneMap, isTranslation, exerciseNumbers, fmtDate, todayISO, answerLabel, r2, keyForStudents, studentItems,
} from "./common.js?v=20261115d";
import { initShell, renderUnitNav, wireUnitNav } from "./shell.js?v=20261115d";
import { builderShell, mountBuilder, builderBusy, builderRefresh } from "./builder.js?v=20261115d";
import { aiPrompt } from "./ai-prompt.js?v=20261115d";

const $ = (s) => document.querySelector(s);
const ls = {
  get: (k, d) => { try { return localStorage.getItem("t:" + k) ?? d; } catch { return d; } },
  set: (k, v) => { try { localStorage.setItem("t:" + k, v); } catch {} },
};
const T = {
  user: null, groups: [], units: [], users: [], usersLoaded: false,
  gid: ls.get("gid", ""), unitId: ls.get("unit", ""),
  students: [], subs: [], results: {}, exr: {},
  unitData: {},          // unitId -> {content, keys, notes}
  selected: null,        // student uid opened in "Student work"
  includeDrafts: false,
  groupFilter: null,
  showCorrect: ls.get("showCorrect", "1") === "1",
  tests: [], testsLoaded: false, testSel: null, attempts: [], testRes: {}, testContent: {},
  unsub: [], ctxUnsub: [],
  practice: {},          // unitId -> {exId: {itemId: value}}: what the teacher types in the unit (kept in this tab only)
  viewAs: "",            // unit page: "" = the teacher's own practice answers, or a student uid whose answers are shown
  unitViewKey: "",
};
const TOOLS = [
  { id: "access", icon: "🔓", title: "Access & results", sub: "Open units, release results" },
  { id: "works", icon: "📝", title: "Student work", sub: "Answers, open-answer marking" },
  { id: "tests", icon: "⏱", title: "Tests", sub: "Timed tests: open, watch, check" },
  { id: "groups", icon: "👥", title: "Groups & students", sub: "Group codes, moving and removing students" },
  { id: "builder", icon: "🧱", title: "Course builder", sub: "Units, sections, exercises: add and edit" },
  { id: "content", icon: "📦", title: "Import and export", sub: "The course as a file, Word books" },
  { id: "settings", icon: "⚙", title: "Course settings", sub: "Title, language, level" },
];

function applyTitle() {
  document.title = `Teacher's Edition · ${courseTitle()}`;
  document.querySelectorAll("[data-course-title]").forEach((el) => (el.textContent = courseTitle()));
  const e = document.querySelector("#auth-screen .auth-card .crs"); if (e) e.textContent = courseTitle();
}
applyTitle();
loadSettings(() => { applyTitle(); render(true); });
initShell();
wireFlashcards();
wireUnitNav($("#unit-nav"), () => renderNav());

function toast(t, ms = 3500) {
  const el = document.createElement("div");
  el.className = "toast"; el.textContent = t;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), ms);
}
async function guard(fn) {
  try { T.lastError = ""; return await fn(); } catch (e) { console.error(e); T.lastError = friendlyError(e); toast("Error: " + T.lastError, 6000); }
}

// ------------------------------------------------------------------ auth
$("#auth-screen").innerHTML = authFormHTML({ eyebrow: courseTitle(), title: "Teacher's Edition", allowRegister: false });
wireAuthForm($("#auth-screen"), {
  async login(f) { await signInWithEmailAndPassword(auth, f.email.trim(), f.password); },
  async reset(f) { await sendPasswordResetEmail(auth, f.email.trim()); return "We have sent you a link to reset your password."; },
});
$("#logout").addEventListener("click", () => signOut(auth));
$("#logout2").addEventListener("click", (e) => { e.preventDefault(); signOut(auth); });

onAuthStateChanged(auth, async (user) => {
  T.unsub.forEach((u) => u()); T.unsub = [];
  T.ctxUnsub.forEach((u) => u()); T.ctxUnsub = []; ctxKey = "";
  T.user = user;
  $("#boot").hidden = true;
  $("#auth-screen").hidden = !!user;
  $("#app").hidden = true; $("#denied").hidden = true;
  if (!user) return;
  const t = await getDoc(doc(db, "teachers", user.uid)).catch(() => null);
  if (!t?.exists()) { $("#denied").hidden = false; return; }
  $("#app").hidden = false;
  $("#me-email").textContent = user.email;

  T.unsub.push(onSnapshot(collection(db, "groups"), (snap) => {
    T.groups = snap.docs.map((d) => ({ id: d.id, openUnits: [], releasedUnits: [], releasedEx: {}, feedbackEx: {}, tests: {}, ...d.data() }))
      .sort((a, b) => (a.name || a.id).localeCompare(b.name || b.id));
    if (!T.groups.find((g) => g.id === T.gid)) T.gid = T.groups[0]?.id || "";
    fillCtx(); subscribeCtx(); render();
  }));
  T.unsub.push(onSnapshot(query(collection(db, "units"), orderBy("order")), (snap) => {
    T.units = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    if (!T.units.find((u) => u.id === T.unitId)) T.unitId = (T.units.find((u) => u.status !== "soon") || T.units[0])?.id || "";
    fillCtx(); subscribeCtx(); render();
  }));
});

// ------------------------------------------------------------------ context: group + unit
function fillCtx() {
  $("#ctx-group").innerHTML = T.groups.map((g) => `<option value="${esc(g.id)}" ${g.id === T.gid ? "selected" : ""}>${esc(g.name || g.id)}</option>`).join("") || `<option value="">no groups yet</option>`;
  $("#ctx-unit").innerHTML = T.units.map((u, i) => `<option value="${esc(u.id)}" ${u.id === T.unitId ? "selected" : ""}>Unit ${u.order || i + 1}</option>`).join("") || `<option value="">no units yet</option>`;
}
$("#ctx-group").addEventListener("change", (e) => { T.gid = e.target.value; ls.set("gid", T.gid); T.selected = null; T.viewAs = ""; T.progOpt.student = ""; subscribeCtx(); render(); });
document.addEventListener("change", (e) => {
  if (e.target.id === "view-as") setViewAs(e.target.value);
  if (e.target.id === "works-student") { T.selected = e.target.value; render(true); setTimeout(() => $("#detail")?.scrollIntoView({ behavior: "smooth" }), 50); }
});
$("#ctx-unit").addEventListener("change", (e) => setUnit(e.target.value));
function setUnit(id) {
  if (!id || id === T.unitId) return;
  T.unitId = id; ls.set("unit", id); T.selected = null;
  $("#ctx-unit").value = id;
  subscribeCtx(); render();
}

let ctxKey = "";
function subscribeCtx() {
  const key = T.gid + "|" + T.unitId;
  if (key === ctxKey) return;
  ctxKey = key;
  T.ctxUnsub.forEach((u) => u()); T.ctxUnsub = [];
  T.students = []; T.subs = []; T.results = {}; T.studentsReady = false;
  if (!T.gid) return;
  // students of the group, their work and results — all in real time
  T.ctxUnsub.push(onSnapshot(query(collection(db, "users"), where("groupId", "==", T.gid)), (snap) => {
    T.students = snap.docs.map((d) => ({ uid: d.id, ...d.data() })).sort((a, b) => a.name.localeCompare(b.name));
    T.studentsReady = true;
    render();
  }));
  if (!T.unitId) return;
  loadUnitData(T.unitId).then(render);
  T.ctxUnsub.push(onSnapshot(query(collection(db, "submissions"), where("groupId", "==", T.gid), where("unitId", "==", T.unitId)), (snap) => {
    T.subs = snap.docs.map((d) => d.data());
    render();
  }));
  T.ctxUnsub.push(onSnapshot(query(collection(db, "exerciseResults"), where("groupId", "==", T.gid), where("unitId", "==", T.unitId)), (snap) => {
    T.exr = Object.fromEntries(snap.docs.map((d) => [d.data().uid, d.data()]));
    render();
  }));
  T.ctxUnsub.push(onSnapshot(query(collection(db, "results"), where("groupId", "==", T.gid), where("unitId", "==", T.unitId)), (snap) => {
    T.results = Object.fromEntries(snap.docs.map((d) => [d.data().uid, d.data()]));
    render();
  }));
}

async function loadUnitData(unitId, force = false) {
  if (T.unitData[unitId] && !force) return T.unitData[unitId];
  const [c, k] = await Promise.all([getDoc(doc(db, "unitContent", unitId)), getDoc(doc(db, "answerKeys", unitId))]);
  T.unitData[unitId] = {
    content: c.exists() ? c.data() : null,
    keys: k.exists() ? k.data().exercises || {} : {},
    notes: k.exists() ? k.data().notes || {} : {},
  };
  return T.unitData[unitId];
}

// ------------------------------------------------------------------ routing & sidebar
// #tools/<id>  — teaching tools;  #<unitId>/<sectionId> — unit with keys and notes
function route() {
  const [a, b] = location.hash.replace(/^#/, "").split("/");
  if (!a || a === "tools") return { tool: TOOLS.find((t) => t.id === b)?.id || "access" };
  return { unit: a, section: b || null };
}
window.addEventListener("hashchange", () => {
  const r = route();
  if (r.unit) setUnit(r.unit);
  T.selected = r.tool === "works" ? T.selected : null;
  render(true);
  window.scrollTo(0, 0);
});

const group = () => T.groups.find((g) => g.id === T.gid);
const unit = () => T.units.find((u) => u.id === T.unitId);
const unitNum = (u) => u.order || T.units.indexOf(u) + 1;

function renderNav() {
  const r = route();
  $("#tool-nav").innerHTML = TOOLS.map((t) => `<a class="sb-item ${r.tool === t.id ? "on" : ""}" href="#tools/${t.id}">
      <span class="ic">${t.icon}</span><span class="t">${t.title}<span class="s">${t.sub}</span></span></a>`).join("");
  const g = group();
  renderUnitNav($("#unit-nav"), {
    units: T.units,
    route: { unit: r.unit, section: r.section },
    empty: `No units yet. Add the first one in <a href="#tools/builder">Course builder</a>.`,
    state: (u) => {
      if (u.status === "soon") return { locked: false, note: "Coming soon", noteClass: "lock" };
      if (!g) return { locked: false, note: "" };
      if (g.releasedUnits.includes(u.id)) return { locked: false, note: `✓ Results released · ${esc(g.name)}`, noteClass: "good" };
      if (g.openUnits.includes(u.id)) return { locked: false, note: `Open for ${esc(g.name)}`, noteClass: "good" };
      return { locked: false, note: `Closed for ${esc(g.name)}`, noteClass: "lock" };
    },
  });
}

function render(force = false) {
  if (!T.user || $("#app").hidden) return;
  renderNav();
  const r = route();
  // A unit page that is already on the screen is not drawn again when students type.
  // The teacher's own answers, an audio file that is playing or a flashcard stay as they are.
  if (!force && r.unit && r.unit === T.unitId && T.unitViewKey && T.unitViewKey === unitViewKey(r)) return;
  // Course builder keeps its own page: database updates never redraw a unit that is being edited
  if (r.tool === "builder" && $("#builder")) { if (!force || builderBusy()) { builderRefresh(); return; } }
  // do not re-render while the teacher is typing a mark, comment or JSON
  const a = document.activeElement;
  if (!force && a && $("#view").contains(a) && a.matches(".g-score,.g-comment,textarea.json,input[type=text],input:not([type]),[data-item],input[type=date]")) return;
  if (r.unit && r.unit !== T.unitId && T.units.some((u) => u.id === r.unit)) { setUnit(r.unit); return; }
  $("#wrap").classList.toggle("wide", !!r.tool && !["content", "builder", "settings"].includes(r.tool));
  T.unitViewKey = "";
  if (r.unit) { $("#view").innerHTML = viewUnit(r); T.unitViewKey = unitViewKey(r); return; }
  const tool = TOOLS.find((t) => t.id === r.tool);
  $("#crumb").innerHTML = `<b>Teaching tools</b> &middot; ${tool.title}`;
  const views = { access: viewAccess, works: viewWorks, tests: viewTests, content: viewContent, builder: viewBuilder, settings: viewSettings, groups: viewGroups };
  $("#view").innerHTML = views[r.tool]();
  if (r.tool === "builder") mountBuilder($("#builder"), {
    units: () => T.units, splitUnit, toast,
    onSaved: (id) => { delete T.unitData[id]; T.testsLoaded = false; ctxKey = ""; subscribeCtx(); },
  });
}

const pageHead = (eyebrow, title, lead = "") =>
  `<header class="page-h"><div class="pe">${eyebrow}</div><h2>${title}</h2>${lead ? `<p class="pl">${lead}</p>` : ""}</header>`;

// ================================================================== Unit with keys
function viewUnit(r) {
  const u = T.units.find((x) => x.id === r.unit);
  if (!u) return pageHead("Unit", "Unit not found");
  const n = unitNum(u);
  $("#crumb").innerHTML = `<b>Unit ${n}</b> &middot; ${esc(u.title)}`;
  const g = group();
  const bar = g && u.status !== "soon" ? accessBar(u, g) : "";
  if (u.status === "soon") return pageHead(`Unit ${n}`, esc(u.title)) + `<div class="locked-msg"><span class="big">🛠</span>This unit is still being prepared. Fill it in <a href="#tools/builder">Course builder</a>.</div>`;
  const d = T.unitData[u.id];
  if (!d) { loadUnitData(u.id).then(() => render(true)); return `<p class="muted">Loading…</p>`; }
  if (!d.content) return pageHead(`Unit ${n}`, esc(u.title)) + `<div class="locked-msg">This unit has no content yet.</div>`;
  const secs = d.content.sections;
  const sec = secs.find((s) => s.id === r.section) || secs[0];
  const i = secs.indexOf(sec);
  const meta = (u.sections || []).find((s) => s.id === sec.id) || {};
  $("#crumb").innerHTML = `<b>Unit ${n}</b> &middot; ${n}.${i + 1} ${esc(sec.title)}`;
  const blocks = [...sec.blocks];
  for (const note of [...(d.notes[sec.id] || [])].reverse()) blocks.splice(note.at, 0, { type: "teacher-note", html: note.html });
  const prev = secs[i - 1], next = secs[i + 1];
  const mine = T.practice[u.id] || {};
  // "Answers shown": the teacher's own practice answers, or one student's work in this unit
  // (while the list of students is still loading after a change of unit, the chosen student is kept)
  if (T.viewAs && T.studentsReady && !T.students.some((s) => s.uid === T.viewAs)) T.viewAs = "";
  const vs = T.viewAs ? T.subs.find((s) => s.uid === T.viewAs) : null;
  const vexr = T.viewAs ? T.exr?.[T.viewAs] : null;
  const vres = T.viewAs ? T.results[T.viewAs] : null;
  const tip = T.viewAs
    ? `<p class="muted tip">You see the answers of <b>${esc(T.students.find((s) => s.uid === T.viewAs)?.name || "")}</b>${vs ? ` (${vs.status === "submitted" ? "submitted" : "draft"}, last change ${esc(fmtTime(vs.updatedAt))})` : ""}: green – correct, red – a mistake with the key next to it. The page follows the student's changes live. Marks for open answers are given in <a href="#tools/works" data-act="select-student" data-uid="${esc(T.viewAs)}">Student work</a>.</p>`
    : `<p class="muted tip">You can type and choose answers here, as the students do: nothing is saved or sent to the students.
       ${Object.keys(mine).length ? `<button class="btn small" data-act="practice-clear" data-unit="${esc(u.id)}">Clear my answers</button>` : ""}</p>`;
  return bar + docxBar(u) + viewAsBar() + pageHead(`Unit ${n} &middot; ${n}.${i + 1}`, esc(sec.title), esc(meta.subtitle || sec.subtitle || ""))
    + tip
    + (T.viewAs && !vs ? `<div class="box">This student has not started the unit yet.</div>` : "")
    + renderBlocks(blocks, (ex) => {
      if (T.viewAs) {
        const ans = vs?.answers?.[ex.id] || {};
        const done = vs && doneMap(vs.answers)[ex.id];
        const graded = vs && isAuto(ex) && Object.values(ans).some((v) => String(v).trim());
        return {
          key: graded ? null : d.keys[ex.id] || {}, readOnly: true, answers: ans,
          auto: graded ? gradeExercise(ex, ans, d.keys[ex.id] || {}).items : undefined,
          manual: vres?.manual?.[ex.id],
          tag: done ? "Done ✓" : vs && Object.values(ans).some((v) => String(v).trim()) ? "Started, not marked Done" : "",
          before: g ? toolsBar(u, ex, g) : "",
        };
      }
      return {
        key: d.keys[ex.id] || {}, readOnly: false,
        answers: mine[ex.id] || {},
        tag: ex.check === "teacher" ? "Checked by the teacher" : "",
        before: g ? toolsBar(u, ex, g) : "",
      };
    }, `${n}.${i + 1}`)
    + `<nav class="pager">
      ${prev ? `<a class="pg" href="#${u.id}/${prev.id}"><span class="d">Previous</span><span class="t">${n}.${i} ${esc(prev.title)}</span></a>` : ""}
      ${next ? `<a class="pg next" href="#${u.id}/${next.id}"><span class="d">Next</span><span class="t">${n}.${i + 2} ${esc(next.title)}</span></a>` : ""}
    </nav>`;
}

// The list above a unit page: whose answers are shown. Students are in alphabetical order; the arrows go to the
// previous and next student, so the teacher can look through the whole group exercise by exercise.
function viewAsBar() {
  if (!group() || !T.students.length) return "";
  const subBy = Object.fromEntries(T.subs.map((s) => [s.uid, s]));
  const i = T.students.findIndex((s) => s.uid === T.viewAs);
  const prev = i > 0 ? T.students[i - 1] : null, next = i < T.students.length - 1 ? T.students[i + 1] : null;
  const label = (s) => { const x = subBy[s.uid]; return `${s.name}${!x ? " · not started" : x.status === "submitted" ? " · submitted" : ""}`; };
  return `<div class="viewas-bar ${T.viewAs ? "on" : ""}"><label for="view-as">Answers shown</label>
    <button class="btn small" data-act="view-as" data-uid="${esc(prev?.uid || "")}" ${i < 0 || !prev ? "disabled" : ""} title="Previous student">Previous</button>
    <select id="view-as"><option value="">My practice (nothing is saved)</option>${T.students.map((s) => `<option value="${esc(s.uid)}" ${s.uid === T.viewAs ? "selected" : ""}>${esc(label(s))}</option>`).join("")}</select>
    <button class="btn small" data-act="view-as" data-uid="${esc((i < 0 ? T.students[0] : next)?.uid || "")}" ${i >= 0 && !next ? "disabled" : ""} title="Next student">Next</button>
    ${T.viewAs ? `<button class="btn small" data-act="view-as" data-uid="">Back to my practice</button>` : ""}</div>`;
}
function viewAsStamp() {
  const s = T.subs.find((x) => x.uid === T.viewAs), e = T.exr?.[T.viewAs], r = T.results[T.viewAs];
  const ms = (t) => t?.toMillis?.() || 0;
  return [ms(s?.updatedAt), s?.status || "", Object.values(e?.feedbackAt || {}).reduce((n, t) => n + ms(t), 0), ms(r?.gradedAt)].join("|");
}
function setViewAs(uid) {
  T.viewAs = uid || "";
  const y = window.scrollY;
  render(true);
  window.scrollTo(0, y);
}

// Download the whole unit as a Word file (no interactive elements): Student's Book or Teacher's Book with keys
function docxBar(u) {
  return `<div class="dl-bar"><span>Download Unit ${esc(unitNum(u))} as Word:</span>
    <button class="btn small" data-act="docx" data-unit="${esc(u.id)}" data-ver="student">Student's Book (.docx)</button>
    <button class="btn small" data-act="docx" data-unit="${esc(u.id)}" data-ver="teacher">Teacher's Book (.docx)</button></div>`;
}
async function downloadDocx(unitId, ver, btn) {
  const u = T.units.find((x) => x.id === unitId);
  if (!u) return;
  const old = btn?.textContent;
  if (btn) { btn.disabled = true; btn.textContent = "Preparing…"; }
  try {
    const d = await loadUnitData(unitId);
    if (!d?.content) throw new Error("This unit has no content yet.");
    const { exportUnitDocx, saveBlob } = await import("./export-docx.js?v=20261115d");
    const teacher = ver === "teacher";
    const sections = d.content.sections.map((s) => ({ ...s, subtitle: (u.sections || []).find((m) => m.id === s.id)?.subtitle || s.subtitle || "" }));
    const blob = await exportUnitDocx({ courseTitle: courseTitle(), unitNum: unitNum(u), unitTitle: u.title, sections,
      keys: teacher ? d.keys : {}, notes: teacher ? d.notes : {}, teacher });
    const safe = (t) => String(t).replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "");
    saveBlob(blob, `${safe(courseTitle())}_Unit-${unitNum(u)}_${teacher ? "Teachers-Book" : "Students-Book"}.docx`);
  } catch (e) { console.error(e); toast("Could not create the Word file: " + (e.message || e), 6000); }
  finally { if (btn) { btn.disabled = false; btn.textContent = old; } }
}

// Exercises marked "check": "teacher" are checked one at a time, when the teacher decides
function exerciseBar(u, ex, g) {
  const done = (g.releasedEx?.[u.id] || []).includes(ex.id);
  return `<div class="tb-row"><span>Group <b>${esc(g.name)}</b>: <span class="pill ${done ? "on" : "off"}">${done ? "checked · results shown" : "not checked yet"}</span>${keyForStudents(ex) ? "" : ` <span class="pill off" title="Students see which answers are right or wrong, but not the correct answer">no correct answer for students</span>`}</span>
    <span class="sp" style="flex:1"></span>
    ${done
      ? `<button class="btn small" data-act="check-ex" data-unit="${esc(u.id)}" data-ex="${esc(ex.id)}" title="Check again, e.g. for students who answered later">Re-check</button>
         <button class="btn small danger" data-act="uncheck-ex" data-unit="${esc(u.id)}" data-ex="${esc(ex.id)}">Hide results</button>`
      : `<button class="btn small good" data-act="check-ex" data-unit="${esc(u.id)}" data-ex="${esc(ex.id)}" ${g.openUnits.includes(u.id) ? "" : "disabled title=\"Open the unit for the group first\""}>Check this exercise now</button>`}
  </div>`;
}

// The bar above each exercise in the Teacher's Edition: checking one exercise when the teacher decides.
function toolsBar(u, ex, g) {
  if (ex.check !== "teacher" || isManual(ex)) return "";
  return `<div class="ex-bar tbar">${exerciseBar(u, ex, g)}</div>`;
}

function unitViewKey(r) {
  const u = T.units.find((x) => x.id === r.unit), g = group(), d = T.unitData[r.unit];
  if (!u || !d?.content) return "";
  return JSON.stringify([u.id, r.section || "", T.gid, u.status, !!g?.openUnits?.includes(u.id), !!g?.releasedUnits?.includes(u.id),
    g?.releasedEx?.[u.id] || [], g?.feedbackEx?.[u.id] || [], g?.plan?.[u.id] || {}, Object.keys(T.practice[u.id] || {}).length > 0,
    // a student's answers on the page: drawn again when the student changes them or gets feedback
    T.viewAs, T.viewAs ? viewAsStamp() : "",
    // the list "Answers shown" is drawn again when the students of the group have loaded
    T.students.map((x) => x.uid).join(",")]);
}

// the teacher's own answers in the unit: kept in memory, never saved
function onPractice(e) {
  const el = e.target;
  if (!el.dataset?.item || !el.dataset.ex || el.matches(".g-score,.g-comment")) return;
  const r = route();
  if (!r.unit || !$("#view").contains(el)) return;
  const v = readInput(el);
  if (v === null) return;
  const had = Object.keys(T.practice[r.unit] || {}).length > 0;
  ((T.practice[r.unit] ??= {})[el.dataset.ex] ??= {})[el.dataset.item] = v;
  if (!had) T.unitViewKey = unitViewKey(r);   // the "Clear my answers" button appears on the next full drawing
}
document.addEventListener("input", onPractice);
document.addEventListener("change", onPractice);


async function checkExercise(gid, unitId, exId) {
  await guard(async () => {
    const { content, keys } = await loadUnitData(unitId, true);
    const ex = exercisesOf(content).find((e) => e.id === exId);
    if (!ex) throw new Error("Exercise not found.");
    const subs = (await getDocs(query(collection(db, "submissions"), where("groupId", "==", gid), where("unitId", "==", unitId)))).docs.map((d) => d.data());
    const answered = subs.filter((s) => Object.values(s.answers?.[exId] || {}).some((v) => String(v).trim()));
    if (!confirm(`Check “${ex.title}” for the group and show the students their results?\nStudents who have answered: ${answered.length} of ${T.students.length}.\nAfter this, students can no longer change their answers in this exercise.`)) return;
    let batch = writeBatch(db), n = 0;
    for (const s of subs) {
      const r = gradeExercise(ex, s.answers?.[exId], keys[exId]);
      r.items = studentItems(ex, r.items, T.showCorrect);   // keys only for gap fills, multiple choice and matching
      batch.set(doc(db, "exerciseResults", subId(unitId, s.uid)), {
        uid: s.uid, groupId: gid, unitId,
        items: { [exId]: r.items }, scores: { [exId]: { score: r2(r.score), max: r.max } },
        updatedAt: serverTimestamp(),
      }, { merge: true });
      if (++n % 400 === 0) { await batch.commit(); batch = writeBatch(db); }
    }
    batch.update(doc(db, "groups", gid), { [`releasedEx.${unitId}`]: arrayUnion(exId) });
    await batch.commit();
    toast(`“${ex.title}” checked for ${subs.length} ${subs.length === 1 ? "student" : "students"}. Only this exercise is closed; the others stay open.`, 6000);
  });
}

function accessBar(u, g) {
  const open = g.openUnits.includes(u.id), rel = g.releasedUnits.includes(u.id);
  return `<div class="ub"><span>Group <b>${esc(g.name)}</b>:
      <span class="pill ${open ? "on" : "off"}">${open ? "open" : "closed"}</span>
      <span class="pill ${rel ? "on" : "off"}">${rel ? "results released" : "results hidden"}</span></span>
    <span class="row">
      <button class="btn small" data-act="toggle-open" data-unit="${esc(u.id)}">${open ? "Close for the group" : "Open for the group"}</button>
      ${rel ? `<button class="btn small danger" data-act="unrelease" data-unit="${esc(u.id)}">Hide whole-unit results</button>` : ""}
    </span>
    <span class="muted" style="flex-basis:100%;font-size:13px">To check one exercise, use the green button above it. The whole unit is checked only in <a href="#tools/access">Access &amp; results</a>.</span></div>`;
}

// ================================================================== Access & results
function viewAccess() {
  const g = group();
  const head = pageHead("Teaching tools", "Access &amp; results",
    "Students see changes immediately, without reloading the page.");
  if (!g) return head + `<div class="box">First create a group in <a href="#tools/groups">Groups &amp; students</a>.</div>`;
  const rows = T.units.map((u) => {
    const soon = u.status === "soon";
    const open = g.openUnits.includes(u.id), rel = g.releasedUnits.includes(u.id);
    return `<tr>
      <td class="num">${unitNum(u)}</td>
      <td><a href="#${esc(u.id)}">${esc(u.title)}</a></td>
      <td>${soon ? `<span class="pill off">coming soon</span>` : `<span class="pill ${open ? "on" : "off"}">${open ? "open" : "closed"}</span>
        <button class="btn small" data-act="toggle-open" data-unit="${esc(u.id)}">${open ? "Close" : "Open"}</button>`}</td>
      <td>${soon ? "" : `<span class="pill ${rel ? "on" : "off"}">${rel ? "released" : "hidden"}</span>
        ${rel
          ? `<button class="btn small" data-act="release" data-unit="${esc(u.id)}" title="Re-check, e.g. for work submitted late">Re-check</button>
             <button class="btn small danger" data-act="unrelease" data-unit="${esc(u.id)}">Hide</button>`
          : `<button class="btn small" data-act="release" data-unit="${esc(u.id)}" ${open ? "" : "disabled"}>Check the whole unit</button>`}`}</td>
    </tr>`;
  }).join("");
  return head + `
  <div class="box"><b>Group: ${esc(g.name)}</b> <span class="muted">(code <code>${esc(g.id)}</code>)</span><br>
  <span class="muted">To check <b>one exercise</b>, open the unit and click <b>Check this exercise now</b> above that exercise. “Check the whole unit” is for the end of a unit: it marks <b>all exercises</b> of all <b>submitted</b> work against the keys and shows the results; after that students can no longer change any answers in the unit.</span>
  <label class="row" style="margin-top:10px"><input type="checkbox" id="show-correct" ${T.showCorrect ? "checked" : ""}> Show students the correct answers to their mistakes</label></div>
  <table class="t"><tr><th>#</th><th>Unit</th><th>Access for the group</th><th>Results</th></tr>${rows}</table>`;
}

document.addEventListener("change", (e) => {
  if (e.target.id === "show-correct") { T.showCorrect = e.target.checked; ls.set("showCorrect", T.showCorrect ? "1" : "0"); }
  if (e.target.id === "g-filter") { T.groupFilter = e.target.value; render(true); }
  if (e.target.matches("select[data-move]")) guard(async () => {
    await updateDoc(doc(db, "users", e.target.dataset.move), { groupId: e.target.value });
    toast("The student has been moved to another group.");
    await loadAllUsers();
  });
  if (e.target.id === "import-file") {
    const f = e.target.files[0];
    if (f) f.text().then((t) => { $("#import-text").value = t; });
  }
});

document.addEventListener("click", (e) => {
  const b = e.target.closest("[data-act]");
  if (!b) return;
  e.preventDefault();
  const act = b.dataset.act, u = b.dataset.unit;
  const handlers = {
    "toggle-open": () => guard(async () => {
      const open = group().openUnits.includes(u);
      await updateDoc(doc(db, "groups", T.gid), { openUnits: open ? arrayRemove(u) : arrayUnion(u) });
    }),
    "release": () => releaseUnit(T.gid, u),
    "check-ex": () => checkExercise(T.gid, u, b.dataset.ex),
    "uncheck-ex": () => guard(async () => {
      if (!confirm("Hide the results of this exercise from the students? They will be able to change their answers again.")) return;
      await updateDoc(doc(db, "groups", T.gid), { [`releasedEx.${u}`]: arrayRemove(b.dataset.ex) });
    }),
    "unrelease": () => guard(async () => {
      if (!confirm("Hide the results from the students? Students will again be able to edit drafts they have not submitted.")) return;
      await updateDoc(doc(db, "groups", T.gid), { releasedUnits: arrayRemove(u) });
    }),
    "select-student": () => { T.selected = b.dataset.uid; if (route().tool !== "works") location.hash = "#tools/works"; else render(true); setTimeout(() => $("#detail")?.scrollIntoView({ behavior: "smooth" }), 50); },
    "save-grades": () => saveGrades(b.dataset.uid),
    "return": () => guard(async () => {
      const st = T.students.find((x) => x.uid === b.dataset.uid);
      const note = prompt(`Return the work of ${st?.name || "this student"} for revision.\nComment for the student (optional): what should be improved?\n\nExercises you have already checked stay closed.`, "");
      if (note === null) return;
      await updateDoc(doc(db, "submissions", subId(T.unitId, b.dataset.uid)), { status: "draft", returnNote: note.trim().slice(0, 1000), returnedAt: serverTimestamp() });
      toast("The work has been returned to the student.");
    }),
    "docx": () => downloadDocx(u, b.dataset.ver, b),
    "practice-clear": () => { delete T.practice[u]; render(true); },
    "view-as": () => setViewAs(b.dataset.uid),
    "import": () => importCourse(),
    "settings-save": () => saveCourseSettings(),
    "ai-prompt-show": () => { const t = $("#aip-text"); t.value = aiPrompt(); t.hidden = !t.hidden; },
    "ai-prompt-copy": async () => {
      const t = $("#aip-text"); t.value = aiPrompt();
      let ok = false;
      try { await navigator.clipboard.writeText(t.value); ok = true; } catch { t.hidden = false; t.focus(); t.select(); try { ok = document.execCommand("copy"); } catch {} }
      $("#aip-status").textContent = ok ? "Copied. Paste it into a chat with your assistant." : "The prompt is selected below: press Ctrl+C (Mac: Cmd+C).";
    },
    "delete-unit": () => deleteUnit(u),
    "create-group": () => createGroup(),
    "load-users": () => loadAllUsers(),
    "remove-student": () => removeStudent(b.dataset.uid),
    "test-open": () => openTest(b.dataset.key),
    "test-close": () => guard(async () => {
      if (!confirm("Close the test? Students who have not finished will not be able to continue.")) return;
      await updateDoc(doc(db, "groups", T.gid), { [`tests.${b.dataset.key}.open`]: false });
    }),
    "test-release": () => releaseTest(b.dataset.key),
    "test-unrelease": () => guard(async () => updateDoc(doc(db, "groups", T.gid), { [`tests.${b.dataset.key}.released`]: false })),
    "test-select": () => { T.testSel = b.dataset.key; subscribeAttempts(); render(true); },
    "test-reset": () => guard(async () => {
      if (!confirm("Delete this student's attempt so that they can take the test again?")) return;
      const id = `${T.testSel}__${b.dataset.uid}`;
      await Promise.all([deleteDoc(doc(db, "testAttempts", id)), deleteDoc(doc(db, "testResults", id))]);
      toast("The student can start the test again.");
    }),
  };
  handlers[act]?.();
});

// Marking runs in the teacher's browser: only teachers are allowed to read the keys.
async function releaseUnit(gid, unitId) {
  await guard(async () => {
    const { content, keys } = await loadUnitData(unitId, true);
    if (!content) throw new Error("This unit has no content.");
    const subs = (await getDocs(query(collection(db, "submissions"), where("groupId", "==", gid), where("unitId", "==", unitId))))
      .docs.map((d) => d.data()).filter((s) => s.status === "submitted");
    const drafts = T.unitId === unitId ? T.subs.filter((s) => s.status === "draft").length : 0;
    const un = T.units.find((x) => x.id === unitId);
    if (!confirm(`Check ALL exercises of Unit ${un ? unitNum(un) : ""} and show the results to the students?\nThis closes the whole unit: students can no longer change any answers.\n(To check one exercise, use the button above that exercise instead.)\n\nSubmitted: ${subs.length}${drafts ? `\nNot submitted (drafts): ${drafts}. These will not be checked and can no longer be edited.` : ""}`)) return;
    const prev = Object.fromEntries((await getDocs(query(collection(db, "results"), where("groupId", "==", gid), where("unitId", "==", unitId))))
      .docs.map((d) => [d.data().uid, d.data()]));
    let batch = writeBatch(db), n = 0;
    for (const sub of subs) {
      const r = buildResult({ sub, content, keys, manual: prev[sub.uid]?.manual || {}, showCorrect: T.showCorrect });
      batch.set(doc(db, "results", subId(unitId, sub.uid)), { ...r, gradedAt: serverTimestamp() });
      if (++n % 400 === 0) { await batch.commit(); batch = writeBatch(db); }
    }
    batch.update(doc(db, "groups", gid), { releasedUnits: arrayUnion(unitId) });
    await batch.commit();
    toast(`Done: ${subs.length} ${subs.length === 1 ? "piece of work" : "pieces of work"} checked. Students can see their results now.`);
  });
}

// ================================================================== Student work
function viewWorks() {
  const g = group(), u = unit();
  const head = pageHead("Teaching tools", "Student work",
    g && u ? `Unit ${unitNum(u)} · ${esc(u.title)} — group ${esc(g.name)}` : "");
  if (!g || !u) return head + `<div class="box">Choose a group and a unit at the top of the page.</div>`;
  const data = T.unitData[u.id];
  if (!data) return head + `<p class="muted">Loading…</p>`;
  if (!data.content) return head + `<div class="box">This unit has no content yet.</div>`;
  const subBy = Object.fromEntries(T.subs.map((s) => [s.uid, s]));
  const exs = exercisesOf(data.content);
  const totalItems = exs.reduce((n, ex) => n + (ex.items || []).length, 0);
  const openTotal = exs.filter((ex) => !isAuto(ex)).reduce((n, ex) => n + ex.items.filter((it) => !it.plain).length, 0);
  const rows = T.students.map((st) => {
    const s = subBy[st.uid], r = T.results[st.uid];
    const filled = s ? exs.reduce((n, ex) => n + (ex.items || []).filter((it) => String(s.answers?.[ex.id]?.[it.id] ?? "").trim()).length, 0) : 0;
    const auto = s ? gradeAuto(data.content, s.answers, data.keys) : null;
    const nDone = s ? exs.filter((ex) => doneMap(s.answers)[ex.id]).length : 0;
    const status = !s ? `<span class="pill off">not started</span>` : s.status === "submitted" ? `<span class="pill on">submitted</span>` : s.returnedAt ? `<span class="pill warn">returned</span>` : `<span class="pill warn">draft</span>`;
    const openDone = r ? openTotal - (r.manualPending ?? openTotal) : 0;
    return `<tr class="${T.selected === st.uid ? "sel" : ""}">
      <td><b>${esc(st.name)}</b><br><small class="muted">${esc(st.email)}</small></td>
      <td>${status}</td>
      <td>${s ? fmtTime(s.status === "submitted" ? s.submittedAt : s.updatedAt) : ""}</td>
      <td class="num">${filled} / ${totalItems}</td>
      <td class="num">${s ? `${nDone} / ${exs.length}` : ""}</td>
      <td class="num">${auto ? `${auto.score} / ${auto.max}` : ""}</td>
      <td class="num">${openTotal ? `${openDone} / ${openTotal}` : "—"}</td>
      <td class="num">${r ? `<b>${r.score} / ${r.max}</b>` : ""}</td>
      <td>${s ? `<div class="row" style="flex-wrap:nowrap;gap:6px"><button class="btn small" data-act="select-student" data-uid="${esc(st.uid)}">Open</button>${returnBtn(s)}</div>` : ""}</td>
    </tr>`;
  }).join("");
  return head + `
    <p class="muted">The table updates live while students work. “Done” shows how many exercises the student has marked as done. “Auto” is a preliminary score against the keys (students do not see it until you release the results). “Open” shows how many open answers you have already marked.</p>
    <table class="t"><tr><th>Student</th><th>Status</th><th>Last change</th><th>Answered</th><th>Done</th><th>Auto</th><th>Open</th><th>Total</th><th></th></tr>
    ${rows || `<tr><td colspan="9" class="muted">There are no students in this group yet.</td></tr>`}</table>
    <div id="detail">${T.selected ? studentDetail(T.selected, data) : ""}</div>`;
}

// "Return for revision": a submitted work becomes editable again; on a draft it sends the student a comment.
// Not possible after the whole unit has been checked (results released): hide those results first.
function returnBtn(s) {
  if (!s) return "";
  if (group()?.releasedUnits.includes(T.unitId))
    return `<button class="btn small" disabled title="The whole unit has been checked. Click “Hide” in Access &amp; results first.">Return for revision</button>`;
  return `<button class="btn small" data-act="return" data-uid="${esc(s.uid)}" title="${s.status === "submitted" ? "The student can change the answers and submit again" : "The student sees your comment at the top of the unit"}">Return for revision</button>`;
}

function studentDetail(uid, data) {
  const st = T.students.find((s) => s.uid === uid);
  const sub = T.subs.find((s) => s.uid === uid);
  if (!st || !sub) return "";
  const r = T.results[uid];
  const auto = gradeAuto(data.content, sub.answers, data.keys);
  const u = unit(), n = unitNum(u);
  const body = data.content.sections.map((sec, i) => {
    const exs = (sec.blocks || []).filter((b) => b.type === "exercise");
    if (!exs.length) return "";
    return `<h3>${n}.${i + 1} ${esc(sec.title)}</h3>` + exs.map((ex, j) => renderExercise(ex, {
      num: `${n}.${i + 1}.${j + 1}`,
      answers: sub.answers?.[ex.id] || {},
      readOnly: true,
      auto: isAuto(ex) ? auto.items[ex.id] : undefined,
      manual: r?.manual?.[ex.id],
      grading: isManual(ex),
    })).join("");
  }).join("");
  // switching between students without going back to the table
  const withWork = T.students.filter((x) => T.subs.some((s) => s.uid === x.uid));
  const k = withWork.findIndex((x) => x.uid === uid), pv = withWork[k - 1], nx = withWork[k + 1];
  const switcher = `<div class="viewas-bar on" style="margin:0 0 12px">
      <button class="btn small" data-act="select-student" data-uid="${esc(pv?.uid || "")}" ${pv ? "" : "disabled"} title="Previous student">Previous</button>
      <select id="works-student">${withWork.map((x) => `<option value="${esc(x.uid)}" ${x.uid === uid ? "selected" : ""}>${esc(x.name)}</option>`).join("")}</select>
      <button class="btn small" data-act="select-student" data-uid="${esc(nx?.uid || "")}" ${nx ? "" : "disabled"} title="Next student">Next</button>
      <span class="muted" style="font-size:13px">${k + 1} of ${withWork.length} students with work in this unit</span></div>`;
  return `<div class="box">
    ${switcher}
    <div class="row" style="justify-content:space-between">
      <h2 style="margin:0">${esc(st.name)} <span class="muted" style="font-size:16px">· auto-checked ${auto.score}/${auto.max}</span></h2>
      <div class="row">
        ${returnBtn(sub)}
        <button class="btn small primary" data-act="save-grades" data-uid="${esc(uid)}">Save marks</button>
      </div>
    </div>
    <p class="muted">Green — correct; red — mistake, with the correct answer next to it. For open answers, enter a score and a comment, then click “Save marks”. If the results are already released, the student sees the mark immediately.</p>
    ${body}
    <div class="row"><button class="btn primary" data-act="save-grades" data-uid="${esc(uid)}">Save marks</button></div>
  </div>`;
}

async function saveGrades(uid) {
  await guard(async () => {
    const data = await loadUnitData(T.unitId);
    const sub = T.subs.find((s) => s.uid === uid);
    const manual = structuredClone(T.results[uid]?.manual || {});
    document.querySelectorAll("#detail .g-score").forEach((inp) => {
      const ex = inp.dataset.ex, it = inp.dataset.item;
      const com = document.querySelector(`#detail .g-comment[data-ex="${CSS.escape(ex)}"][data-item="${CSS.escape(it)}"]`);
      manual[ex] ??= {};
      manual[ex][it] = { score: inp.value === "" ? null : Number(inp.value), comment: com?.value || "" };
    });
    const showCorrect = T.results[uid]?.showCorrect ?? T.showCorrect;
    const r = buildResult({ sub, content: data.content, keys: data.keys, manual, showCorrect });
    await setDoc(doc(db, "results", subId(T.unitId, uid)), { ...r, gradedAt: serverTimestamp() });
    document.activeElement?.blur();
    toast("Marks saved.");
    render(true);
  });
}

// ================================================================== Course builder (builder.js) and Course settings
function viewBuilder() {
  return pageHead("Teaching tools", "Course builder", "Build the course here: units, sections, texts, media and exercises with their keys. Nothing reaches students until you click Save and publish.") + builderShell();
}
function viewSettings() {
  const sel = (id, list, v) => `<select id="${id}">${list.map(([c, n]) => `<option value="${esc(c)}" ${c === v ? "selected" : ""}>${esc(n)}</option>`).join("")}</select>`;
  return pageHead("Teaching tools", "Course settings", "The name of the course and the language you teach. Students see the changes after they reload the page.") + `
  <div class="box set-form">
    <h3 style="margin-top:0">Name</h3>
    <label class="bf"><span class="bf-l">Title of the course</span><input type="text" id="set-title" value="${esc(courseTitle())}"></label>
    <label class="bf"><span class="bf-l">Line above the title in the student's book</span><input type="text" id="set-book" value="${esc(CS.bookTitle || "")}" placeholder="Course Workbook"></label>
    <h3>Language and learners</h3>
    <label class="bf"><span class="bf-l">Language of the course (the language students write and speak in)</span>${sel("set-lang", LANGS, CS.lang)}</label>
    <label class="bf"><span class="bf-l">First language of most learners</span>${sel("set-first", FIRST_LANGS, CS.firstLang || "")}</label>
    <div class="bld-partgrid">
      <label class="bf"><span class="bf-l">Level of the course (can be empty)</span><input type="text" id="set-level" value="${esc(CS.level || "")}" placeholder="B1–B2"></label>
      <label class="bf"><span class="bf-l">Who the learners are (can be empty)</span><input type="text" id="set-aud" value="${esc(CS.audience || "")}" placeholder="first-year university students of economics"></label>
    </div>
    <div class="row" style="margin-top:14px"><button class="btn primary" data-act="settings-save">Save the settings</button><span id="set-status" class="muted">${T.setStatus || ""}</span></div>
  </div>
  <div class="box"><h3 style="margin-top:0">What is collected</h3>
    <p class="muted" style="margin:0">The course keeps every answer with the time of its last change, drafts before submission, Done marks and the results of every exercise and test. You see them in Student work.
    The first setup of the database is described in the <a href="setup.html" target="_blank">Setup guide</a>.</p></div>`;
}
async function saveCourseSettings() {
  await guard(async () => {
    await saveSettings({
      title: $("#set-title").value.trim(), bookTitle: $("#set-book").value.trim() || "Course Workbook",
      lang: $("#set-lang").value, firstLang: $("#set-first").value, level: $("#set-level").value.trim(), audience: $("#set-aud").value.trim(),
    });
    T.setStatus = `<b style="color:var(--ok)">✓ Saved at ${fmtTime(new Date())}.</b>`;
    applyTitle(); render(true); toast("Settings saved.");
  });
}

// ================================================================== Course content
function viewContent() {
  const rows = T.units.map((u) => `<tr>
    <td class="num">${esc(u.order)}</td><td><code>${esc(u.id)}</code></td><td>${u.status === "soon" ? esc(u.title) : `<a href="#${esc(u.id)}">${esc(u.title)}</a>`}</td>
    <td>${u.status === "soon" ? `<span class="pill off">coming soon</span>` : `<span class="pill on">${(u.sections || []).length} sections</span>`}</td>
    <td>${u.status === "soon" ? "" : `<button class="btn small" data-act="docx" data-unit="${esc(u.id)}" data-ver="student" title="Student's Book in Word">Student .docx</button>
      <button class="btn small" data-act="docx" data-unit="${esc(u.id)}" data-ver="teacher" title="Teacher's Book in Word, with keys and notes">Teacher .docx</button>`}
      <button class="btn small danger" data-act="delete-unit" data-unit="${esc(u.id)}">Delete</button></td></tr>`).join("");
  return pageHead("Teaching tools", "Import and export", "The course as one file: a backup, a copy for a colleague, or a course written outside the builder. To edit the course, use Course builder.") + `
  <div class="box">
    <h3 style="margin-top:0">Write a unit with an AI assistant</h3>
    <p class="muted">Any capable assistant (ChatGPT, Gemini, Claude, DeepSeek and others) can write a unit as a course file. The prompt below explains the file format to it.</p>
    <ol class="muted" style="padding-left:20px;margin:0 0 10px">
      <li>Click <b>Copy the prompt</b> and paste it into a new chat with the assistant. Fill in the lines under MY REQUEST.</li>
      <li>To change a unit you already have, download it in Course builder (button <b>File</b> next to the unit) and attach or paste that file after the prompt.</li>
      <li>Copy the assistant's answer (or save it as a <code>.json</code> file) and import it below. If the import reports an error, paste the error message back to the assistant and ask it to correct the file.</li>
      <li>Open the unit in Course builder and <b>read everything</b>: check the keys, the facts and the level. An assistant makes mistakes, and you answer for the course.</li>
    </ol>
    <div class="row"><button class="btn primary" data-act="ai-prompt-copy">Copy the prompt</button><button class="btn" data-act="ai-prompt-show">Show the prompt</button><span id="aip-status" class="muted"></span></div>
    <textarea class="json" id="aip-text" readonly hidden></textarea>
    <p class="muted" style="margin:8px 0 0">Do not paste students' names or work into an assistant. A unit with the same <code>id</code> replaces the old one; students' answers are kept as long as the ids of the exercises stay the same.</p>
  </div>
  <div class="box">
    <h3 style="margin-top:0">Import units from JSON</h3>
    <p class="muted">Keep the course file on your computer, not in the public repository. On import, the <code>answer</code> fields are removed from the exercises and stored separately as keys, and <code>teacher-note</code> blocks become teaching notes. Students receive neither.
    Importing a unit with an existing <code>id</code> replaces it; students' answers are kept.</p>
    <div class="row"><input type="file" id="import-file" accept=".json,application/json"></div>
    <textarea class="json" id="import-text" placeholder='{"units":[{"id":"u1","order":1,"title":"…","sections":[…]}]}'></textarea>
    <div class="row"><button class="btn primary" data-act="import" id="import-btn">Import</button><span id="import-status" class="muted">${T.importStatus || ""}</span></div>
  </div>
  <table class="t"><tr><th>#</th><th>id</th><th>Unit</th><th>Status</th><th></th></tr>${rows || `<tr><td colspan="5" class="muted">The course is empty. Build it in <a href="#tools/builder">Course builder</a> or import a file.</td></tr>`}</table>`;
}

// Strip the answers out of one exercise: returns the exercise for students and its keys
function stripExercise(b, seen, where) {
  if (!b.id || seen.has(b.id)) throw new Error(`Missing or repeated exercise id “${b.id}” (${where})`);
  seen.add(b.id);
  if (!KIND_LABEL[b.kind]) throw new Error(`Exercise ${b.id}: unknown kind “${b.kind}” (gap | match | mcq | open)`);
  const keys = {};
  const items = (b.items || []).map((it) => {
    const { answer, ...rest } = it;
    if (it.id === undefined) throw new Error(`Exercise ${b.id}: an item has no id`);
    rest.id = String(it.id);
    if (b.kind !== "open" && b.graded !== false) {
      if (answer === undefined || answer === "") throw new Error(`Exercise ${b.id}, item ${it.id}: no answer`);
      keys[rest.id] = answer;
    }
    else if (b.kind === "open" && answer) keys[rest.id] = answer;   // model answer, teacher only
    return rest;
  });
  return { ex: { ...b, type: "exercise", items }, keys };
}

function splitUnit(u) {
  if (!u.id || !/^[A-Za-z0-9_-]+$/.test(u.id)) throw new Error(`Invalid unit id “${u.id}” (use Latin letters, digits, - and _)`);
  if (!u.title) throw new Error(`Unit ${u.id} has no title`);
  const hasContent = Array.isArray(u.sections) && u.sections.some((s) => (s.blocks || []).length);
  const meta = {
    title: u.title, order: Number(u.order ?? 0),
    status: u.status || (hasContent ? "ready" : "soon"),
    sections: (u.sections || []).map((s) => ({ id: s.id, title: s.title, ...(s.subtitle ? { subtitle: s.subtitle } : {}) })),
  };
  // timed tests: hidden from students until the teacher opens them
  const tests = {}, testKeys = {};
  for (const t of u.tests || []) {
    if (!t.id || !/^[A-Za-z0-9_-]+$/.test(t.id) || tests[t.id]) throw new Error(`Unit ${u.id}: test with a missing or repeated id “${t.id}”`);
    if (!(Number(t.minutes) > 0)) throw new Error(`Test ${t.id}: set "minutes" (the time limit)`);
    const seenT = new Set(), keysT = {};
    const exercises = (t.exercises || []).map((b) => { const r = stripExercise(b, seenT, `${u.id}, test ${t.id}`); keysT[b.id] = r.keys; return r.ex; });
    tests[t.id] = { unitId: u.id, testId: t.id, title: t.title || "Test", minutes: Number(t.minutes), rubric: t.rubric || "", exercises };
    testKeys[t.id] = { title: t.title || "Test", minutes: Number(t.minutes), keys: keysT };
  }
  if (!hasContent) return { meta, tests, keys: Object.keys(tests).length ? { exercises: {}, notes: {}, tests: testKeys } : null };
  const keys = {}, notes = {}, seen = new Set();
  const sections = u.sections.map((s) => {
    if (!s.id || !s.title) throw new Error(`A section in unit ${u.id} has no id or title`);
    const blocks = [];
    for (const b of s.blocks || []) {
      if (b.type === "teacher-note") { (notes[s.id] ??= []).push({ at: blocks.length, html: b.html }); continue; }
      if (b.type !== "exercise") { blocks.push(b); continue; }
      const r = stripExercise(b, seen, u.id);
      keys[b.id] = r.keys;
      blocks.push(r.ex);
    }
    return { id: s.id, title: s.title, ...(s.subtitle ? { subtitle: s.subtitle } : {}), blocks };
  });
  return { meta, content: { sections, ...(Array.isArray(u.grammar) ? { grammar: u.grammar } : {}) }, tests, keys: { exercises: keys, notes, tests: testKeys } };
}

function setImportStatus(html) {
  T.importStatus = html;
  const el = $("#import-status");
  if (el) el.innerHTML = html;
}
async function importCourse() {
  const btn = $("#import-btn");
  if (btn) btn.disabled = true;
  setImportStatus("Importing…");
  // if the database does not confirm the import, say so instead of waiting silently
  const slow = setTimeout(() => setImportStatus("<b>Still waiting for the database…</b> Check the internet connection. If this message stays, reload the page and import again."), 20000);
  await guard(async () => {
    const raw = $("#import-text").value.trim();
    if (!raw) throw new Error("Paste JSON or choose a file.");
    let json;
    try { json = JSON.parse(raw); } catch (e) {
      // an AI assistant often wraps the file in a code fence or adds a sentence before it: take the part from the first { to the last }
      const a = raw.indexOf("{"), b = raw.lastIndexOf("}");
      try { if (a < 0 || b <= a) throw e; json = JSON.parse(raw.slice(a, b + 1)); } catch { throw new Error("The JSON has an error: " + e.message); }
    }
    const list = json.units || [json];
    const parts = list.map(splitUnit);          // validate everything first
    const batch = writeBatch(db);
    parts.forEach((p, i) => {
      const id = list[i].id;
      batch.set(doc(db, "units", id), p.meta);
      if (p.content) batch.set(doc(db, "unitContent", id), p.content);
      if (p.keys) batch.set(doc(db, "answerKeys", id), p.keys);
      for (const [tid, t] of Object.entries(p.tests || {})) batch.set(doc(db, "testContent", `${id}--${tid}`), t);
    });
    await batch.commit();
    for (const l of list) delete T.unitData[l.id];
    T.testsLoaded = false;
    // the page may already have been redrawn by the database update: the field can be gone
    const ta = $("#import-text"); if (ta) ta.value = "";
    const summary = parts.filter((p) => p.content).map((p, i) => {
      const u = list[parts.indexOf(p)];
      const nEx = p.content.sections.reduce((n, sec) => n + sec.blocks.filter((b) => b.type === "exercise" || b.numbered).length, 0);
      return `Unit ${u.order || i + 1}: ${p.content.sections.length} ${p.content.sections.length === 1 ? "section" : "sections"}, ${nEx} exercises`;
    }).join("; ");
    setImportStatus(`<b style="color:var(--ok)">✓ Imported ${parts.length} units at ${fmtTime(new Date())}.</b> ${esc(summary)}`);
    toast(`Units imported: ${parts.length}`);
    ctxKey = ""; subscribeCtx(); render(true);
  });
  clearTimeout(slow);
  if (btn) btn.disabled = false;
  if (T.importStatus === "Importing…") setImportStatus(`<b style="color:var(--bad)">The import did not work:</b> ${esc(T.lastError || "unknown error")}`);
}

async function deleteUnit(u) {
  if (!confirm(`Delete unit “${u}” together with its keys? Students' answers stay in the database.`)) return;
  await guard(async () => {
    await Promise.all(["units", "unitContent", "answerKeys"].map((c) => deleteDoc(doc(db, c, u))));
    toast("Unit deleted.");
  });
}

// ================================================================== Groups & students
function viewGroups() {
  // the list is refreshed every time the page is opened (new students may have registered meanwhile)
  if (!T.usersLoaded || Date.now() - (T.usersAt || 0) > 10000) setTimeout(loadAllUsers, 0);
  const counts = {};
  T.users.forEach((u) => (counts[u.groupId] = (counts[u.groupId] || 0) + 1));
  const filter = T.groupFilter ?? T.gid;
  const list = T.users.filter((u) => !filter || u.groupId === filter).sort((a, b) => a.name.localeCompare(b.name));
  return pageHead("Teaching tools", "Groups &amp; students", "Students enter the group code when they create an account.") + `
  <div class="box"><div class="row">
    <input id="g-name" placeholder="Group name, e.g. PA-21">
    <input id="g-code" placeholder="Code (optional)" style="width:12em">
    <button class="btn primary" data-act="create-group">Create group</button>
  </div><p class="muted" style="margin:8px 0 0">If you leave the code empty, one will be generated.</p></div>
  <table class="t"><tr><th>Code</th><th>Group</th><th>Students</th><th>Open units</th></tr>
  ${T.groups.map((g) => `<tr><td><code>${esc(g.id)}</code></td><td>${esc(g.name)}</td><td class="num">${T.usersLoaded ? counts[g.id] || 0 : "…"}</td><td>${g.openUnits.map((id) => { const u = T.units.find((x) => x.id === id); return u ? unitNum(u) : esc(id); }).join(", ") || "—"}</td></tr>`).join("")
    || `<tr><td colspan="4" class="muted">No groups yet.</td></tr>`}</table>

  <h3>Students</h3>
  <div class="row">Show: <select id="g-filter"><option value="">all groups</option>${T.groups.map((g) => `<option value="${esc(g.id)}" ${filter === g.id ? "selected" : ""}>${esc(g.name)}</option>`).join("")}</select>
  <button class="btn small" data-act="load-users">Refresh</button></div>
  <table class="t"><tr><th>Name</th><th>Email</th><th>Group</th><th></th></tr>
  ${list.map((u) => `<tr><td>${esc(u.name)}</td><td>${esc(u.email)}</td>
    <td><select data-move="${esc(u.uid)}">${T.groups.map((g) => `<option value="${esc(g.id)}" ${g.id === u.groupId ? "selected" : ""}>${esc(g.name)}</option>`).join("")}</select></td>
    <td><button class="btn small danger" data-act="remove-student" data-uid="${esc(u.uid)}">Remove from course</button></td></tr>`).join("")
    || `<tr><td colspan="4" class="muted">${T.usersLoaded ? "No students" : "Loading…"}</td></tr>`}</table>
  <p class="muted">Removing a student deletes their profile and all their answers, marks and test attempts. The student can no longer open the course with this account.</p>`;
}

let loadingUsers = false;
async function loadAllUsers() {
  if (!T.user || loadingUsers) return;
  loadingUsers = true;
  await guard(async () => {
    const snap = await getDocs(collection(db, "users"));
    T.users = snap.docs.map((d) => ({ uid: d.id, ...d.data() }));
    T.usersLoaded = true;
  });
  loadingUsers = false;
  T.usersLoaded = true;
  T.usersAt = Date.now();      // also after an error, so that the page does not retry in a loop
  render(true);
}

// Removing a student: their work first, the profile last (if something fails, the student is still listed and the teacher can try again).
// The sign-in account itself stays in Firebase Authentication; without a profile it cannot open any unit.
async function removeStudent(uid) {
  const st = T.users.find((u) => u.uid === uid);
  if (!st) return;
  const gname = T.groups.find((g) => g.id === st.groupId)?.name || st.groupId;
  if (!confirm(`Remove ${st.name} (${st.email}, group ${gname}) from the course?\n\nTheir profile and all their answers, marks and test attempts will be deleted. This cannot be undone.`)) return;
  await guard(async () => {
    const colls = ["submissions", "exerciseResults", "results", "testAttempts", "testResults"];
    const snaps = await Promise.all(colls.map((c) => getDocs(query(collection(db, c), where("uid", "==", uid)))));
    const refs = snaps.flatMap((sn, i) => sn.docs.map((d) => doc(db, colls[i], d.id)));
    let batch = writeBatch(db), n = 0;
    for (const r of refs) {
      batch.delete(r);
      if (++n % 400 === 0) { await batch.commit(); batch = writeBatch(db); }
    }
    await batch.commit();
    await deleteDoc(doc(db, "users", uid));
    if (T.selected === uid) T.selected = null;
    toast(`${st.name} has been removed from the course.`);
    await loadAllUsers();
  });
}

async function createGroup() {
  await guard(async () => {
    const name = $("#g-name").value.trim();
    let code = $("#g-code").value.trim().toUpperCase();
    if (!name) throw new Error("Please enter a group name.");
    if (!code) {
      const abc = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
      code = "G-" + Array.from(crypto.getRandomValues(new Uint8Array(5)), (x) => abc[x % abc.length]).join("");
    }
    if (!/^[A-Z0-9-]{3,24}$/.test(code)) throw new Error("The code must be 3–24 characters: Latin letters, digits and hyphens.");
    if ((await getDoc(doc(db, "groups", code))).exists()) throw new Error("A group with this code already exists.");
    await setDoc(doc(db, "groups", code), { name, openUnits: [], releasedUnits: [], createdAt: serverTimestamp() });
    $("#g-name").value = ""; $("#g-code").value = "";
    document.activeElement?.blur();
    toast(`Group created. Code for students: ${code}`, 8000);
    loadAllUsers();
  });
}

// ================================================================== Timed tests
// Tests are described in course.json (unit.tests) and stored apart from the book:
// testContent/{unitId--testId} — questions; answerKeys/{unitId}.tests — keys.
async function loadTests() {
  if (T.testsLoading) return;
  T.testsLoading = true;
  const list = [];
  for (const u of T.units) {
    const k = await getDoc(doc(db, "answerKeys", u.id)).catch(() => null);
    for (const [tid, t] of Object.entries(k?.exists() ? k.data().tests || {} : {})) {
      list.push({ key: `${u.id}--${tid}`, unitId: u.id, testId: tid, title: t.title, minutes: t.minutes, keys: t.keys || {} });
    }
  }
  T.tests = list; T.testsLoaded = true; T.testsLoading = false;
  render(true);
}

let attUnsub = null, attKey = "";
function subscribeAttempts() {
  const key = `${T.gid}|${T.testSel}`;
  if (key === attKey) return;
  attKey = key; attUnsub?.(); T.attempts = []; T.testRes = {};
  if (!T.gid || !T.testSel) return;
  const u1 = onSnapshot(query(collection(db, "testAttempts"), where("groupId", "==", T.gid), where("testKey", "==", T.testSel)),
    (snap) => { T.attempts = snap.docs.map((d) => d.data({ serverTimestamps: "estimate" })); render(); });
  const u2 = onSnapshot(query(collection(db, "testResults"), where("groupId", "==", T.gid), where("testKey", "==", T.testSel)),
    (snap) => { T.testRes = Object.fromEntries(snap.docs.map((d) => [d.data().uid, d.data()])); render(); });
  attUnsub = () => { u1(); u2(); };
  if (!T.testContent?.[T.testSel]) getDoc(doc(db, "testContent", T.testSel)).then((d) => { (T.testContent ??= {})[T.testSel] = d.data(); render(); });
}
setInterval(() => { if (route().tool === "tests" && T.testSel) render(); }, 5000);

function viewTests() {
  const g = group();
  const head = pageHead("Teaching tools", "Tests", "Timed tests stay hidden from students until you open them for a group.");
  if (!g) return head + `<div class="box">First create a group in <a href="#tools/groups">Groups &amp; students</a>.</div>`;
  if (!T.testsLoaded) { loadTests(); return head + `<p class="muted">Loading…</p>`; }
  if (!T.tests.length) return head + `<div class="box">There are no tests in the course yet. Tests are added to a unit in the course file (<code>"tests"</code>) and imported in <a href="#tools/content">Course content</a>.</div>`;
  if (T.testSel) subscribeAttempts();
  const rows = T.tests.map((t) => {
    const cfg = g.tests?.[t.key];
    const u = T.units.find((x) => x.id === t.unitId);
    const status = cfg?.released ? `<span class="pill on">results shown</span>`
      : cfg?.open ? `<span class="pill warn">open now</span>`
      : cfg ? `<span class="pill off">closed</span>` : `<span class="pill off">hidden</span>`;
    return `<tr class="${T.testSel === t.key ? "sel" : ""}">
      <td><b>${esc(t.title)}</b><br><small class="muted">Unit ${u ? unitNum(u) : esc(t.unitId)}</small></td>
      <td class="num">${t.minutes} min</td>
      <td>${status}</td>
      <td class="row">
        ${cfg?.open ? `<button class="btn small" data-act="test-close" data-key="${esc(t.key)}">Close</button>`
                    : `<button class="btn small good" data-act="test-open" data-key="${esc(t.key)}">${cfg ? "Open again" : "Open for the group"}</button>`}
        ${cfg?.released ? `<button class="btn small danger" data-act="test-unrelease" data-key="${esc(t.key)}">Hide results</button>`
                        : cfg ? `<button class="btn small" data-act="test-release" data-key="${esc(t.key)}">Check &amp; show results</button>` : ""}
        <button class="btn small" data-act="test-select" data-key="${esc(t.key)}">Details</button>
      </td></tr>`;
  }).join("");
  return head + `<table class="t"><tr><th>Test</th><th>Time</th><th>Group ${esc(g.name)}</th><th></th></tr>${rows}</table>
    ${T.testSel ? testDetail(g) : ""}`;
}

function testDetail(g) {
  const t = T.tests.find((x) => x.key === T.testSel);
  const c = T.testContent?.[T.testSel];
  if (!t) return "";
  const byUid = Object.fromEntries((T.attempts || []).map((a) => [a.uid, a]));
  const now = Date.now();
  const rows = T.students.map((st) => {
    const a = byUid[st.uid], r = T.testRes?.[st.uid];
    let status = `<span class="pill off">not started</span>`, time = "";
    if (a) {
      const start = a.startedAt?.toMillis?.() || now, end = start + t.minutes * 60000;
      if (a.status === "submitted") { status = `<span class="pill on">submitted</span>`; time = fmtTime(a.updatedAt); }
      else if (now < end && g.tests?.[t.key]?.open) { status = `<span class="pill warn">in progress</span>`; time = `${Math.ceil((end - now) / 60000)} min left`; }
      else { status = `<span class="pill on">time over</span>`; time = fmtTime(a.updatedAt); }
    }
    let prelim = "";
    if (a && c) {
      let sc = 0, mx = 0;
      for (const ex of c.exercises || []) { const gr = gradeExercise(ex, a.answers?.[ex.id], t.keys[ex.id]); if (isAuto(ex)) { sc += gr.score; mx += gr.max; } }
      prelim = `${sc} / ${mx}`;
    }
    const answered = a ? Object.values(a.answers || {}).reduce((n, ex) => n + Object.values(ex).filter((v) => String(v).trim()).length, 0) : 0;
    return `<tr><td><b>${esc(st.name)}</b></td><td>${status}</td><td>${a ? fmtTime(a.startedAt) : ""}</td><td>${time}</td>
      <td class="num">${a ? answered : ""}</td><td class="num">${prelim}</td><td class="num">${r ? `<b>${r.score} / ${r.max}</b>` : ""}</td>
      <td>${a ? `<button class="btn small" data-act="test-reset" data-uid="${esc(st.uid)}">Allow a new attempt</button>` : ""}</td></tr>`;
  }).join("");
  const preview = c ? renderBlocks(c.exercises || [], (ex) => ({ key: t.keys[ex.id] || {}, readOnly: true })) : `<p class="muted">Loading…</p>`;
  return `<div class="box"><h2 style="margin-top:0">${esc(t.title)} <span class="muted" style="font-size:16px">· ${t.minutes} minutes · group ${esc(g.name)}</span></h2>
    <p class="muted">The table updates live. “Score” is preliminary; students see it only after “Check &amp; show results”.</p>
    <table class="t"><tr><th>Student</th><th>Status</th><th>Started</th><th>Time</th><th>Answered</th><th>Score</th><th>Released</th><th></th></tr>
    ${rows || `<tr><td colspan="8" class="muted">There are no students in this group yet.</td></tr>`}</table>
    <details><summary>Questions with keys</summary>${preview}</details></div>`;
}

async function openTest(key) {
  const t = T.tests.find((x) => x.key === key);
  await guard(async () => {
    if (!confirm(`Open “${t.title}” for the group now?\nEach student has ${t.minutes} minutes from the moment they click “Start the test”.`)) return;
    await updateDoc(doc(db, "groups", T.gid), {
      [`tests.${key}`]: { open: true, released: false, minutes: t.minutes, title: t.title, unitId: t.unitId, openedAt: serverTimestamp() },
    });
    T.testSel = key; subscribeAttempts();
    toast("The test is open. Students can see it in their sidebar.");
  });
}

async function releaseTest(key) {
  const t = T.tests.find((x) => x.key === key);
  await guard(async () => {
    const c = (await getDoc(doc(db, "testContent", key))).data();
    const atts = (await getDocs(query(collection(db, "testAttempts"), where("groupId", "==", T.gid), where("testKey", "==", key)))).docs.map((d) => d.data());
    if (!confirm(`Check the test and show the results?\nAttempts: ${atts.length}. The test will be closed for the group.`)) return;
    let batch = writeBatch(db), n = 0;
    for (const a of atts) {
      const items = {}; let score = 0, max = 0;
      for (const ex of c.exercises || []) {
        if (!isAuto(ex)) continue;
        const gr = gradeExercise(ex, a.answers?.[ex.id], t.keys[ex.id]);
        gr.items = studentItems(ex, gr.items, T.showCorrect);
        items[ex.id] = gr.items; score += gr.score; max += gr.max;
      }
      batch.set(doc(db, "testResults", `${key}__${a.uid}`), { uid: a.uid, groupId: T.gid, testKey: key, items, score, max, gradedAt: serverTimestamp() });
      if (++n % 400 === 0) { await batch.commit(); batch = writeBatch(db); }
    }
    batch.update(doc(db, "groups", T.gid), { [`tests.${key}.open`]: false, [`tests.${key}.released`]: true });
    await batch.commit();
    toast(`Checked: ${atts.length}. Students can see their results now.`);
  });
}

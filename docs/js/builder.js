// Course builder (Teacher's Edition): the visual editor of the course.
// The teacher adds, renames, reorders and deletes units, sections and timed tests, and fills the sections with blocks:
// texts, pictures, audio, video, flashcards and exercises with their keys. No code and no files.
//
// How it works: a unit is read from the database and put together again with its keys and teaching notes (joinUnit);
// the teacher edits this copy in the browser; "Save and publish" sends it through the same splitUnit() as the JSON import,
// so the keys and notes are stored apart from what students receive, exactly as before.
// Ids of units, sections, exercises and items are made once and never change: students' answers stay attached
// when something is renamed or moved.
import { db, doc, getDoc, getDocs, collection, query, where, writeBatch, updateDoc } from "./fb.js?v=20261115d";
import { esc, renderBlocks, renderExercise, renderFlashcards, KIND_LABEL } from "./common.js?v=20261115d";
import { feat, langName } from "./course-state.js?v=20261115d";
import { SAMPLE_UNIT } from "./sample-unit.js?v=20261115d";

const B = { api: null, root: null, unitId: null, unit: null, dirty: false, part: null, edit: null, loading: false, msg: "", restored: false };
const clone = (x) => JSON.parse(JSON.stringify(x));
const draftKey = (id) => "builder:draft:" + id;

// ------------------------------------------------------------------ database copy of a unit, with keys and notes
export function joinUnit(meta, content, keysDoc, testDocs = []) {
  const keys = keysDoc?.exercises || {}, notes = keysDoc?.notes || {}, tkeys = keysDoc?.tests || {};
  const withKeys = (ex, k) => ({ ...ex, items: (ex.items || []).map((it) => (k?.[it.id] !== undefined ? { ...it, answer: k[it.id] } : { ...it })) });
  const secSrc = content?.sections || (meta.sections || []).map((s) => ({ ...s, blocks: [] }));
  const sections = secSrc.map((s) => {
    const blocks = (s.blocks || []).map((b) => (b.type === "exercise" ? withKeys(b, keys[b.id]) : { ...b }));
    for (const n of [...(notes[s.id] || [])].reverse()) blocks.splice(n.at, 0, { type: "teacher-note", html: n.html });
    return { id: s.id, title: s.title, ...(s.subtitle ? { subtitle: s.subtitle } : {}), blocks };
  });
  const tests = testDocs.map((t) => ({
    id: t.testId, title: t.title, minutes: t.minutes, rubric: t.rubric || "",
    exercises: (t.exercises || []).map((ex) => withKeys(ex, tkeys[t.testId]?.keys?.[ex.id])),
  }));
  return {
    id: meta.id, order: meta.order, title: meta.title, status: meta.status === "soon" ? "soon" : "ready",
    ...(Array.isArray(content?.grammar) ? { grammar: content.grammar } : {}),
    sections, ...(tests.length ? { tests } : {}),
  };
}
async function fetchUnit(meta) {
  const [c, k, t] = await Promise.all([
    getDoc(doc(db, "unitContent", meta.id)), getDoc(doc(db, "answerKeys", meta.id)),
    getDocs(query(collection(db, "testContent"), where("unitId", "==", meta.id))),
  ]);
  return joinUnit(meta, c.exists() ? c.data() : null, k.exists() ? k.data() : null, t.docs.map((d) => d.data()));
}

// Writes one unit. Everything students receive and the keys go in one batch.
async function writeUnit(u, oldTestIds = []) {
  const p = B.api.splitUnit({ ...u, status: u.status });
  const batch = writeBatch(db);
  batch.set(doc(db, "units", u.id), { ...p.meta, status: u.status === "soon" ? "soon" : "ready" });
  const content = p.content || { sections: (u.sections || []).map((s) => ({ id: s.id, title: s.title, ...(s.subtitle ? { subtitle: s.subtitle } : {}), blocks: [] })) };
  batch.set(doc(db, "unitContent", u.id), content);
  batch.set(doc(db, "answerKeys", u.id), p.keys || { exercises: {}, notes: {}, tests: {} });
  for (const [tid, t] of Object.entries(p.tests || {})) batch.set(doc(db, "testContent", `${u.id}--${tid}`), t);
  for (const tid of oldTestIds) if (!p.tests?.[tid]) batch.delete(doc(db, "testContent", `${u.id}--${tid}`));
  await batch.commit();
}

// ------------------------------------------------------------------ ids
const allExercises = (u) => [...(u.sections || []).flatMap((s) => s.blocks || []), ...(u.tests || []).flatMap((t) => t.exercises || [])];
function newId(prefix, taken) {
  for (let n = 1; ; n++) if (!taken.has(prefix + n)) return prefix + n;
}
const exId = (u) => newId("q", new Set(allExercises(u).map((b) => b.id).filter(Boolean)));
const blockId = (u) => newId("sp", new Set(allExercises(u).map((b) => b.id).filter(Boolean)));
function sectionId(u, title) {
  const taken = new Set((u.sections || []).map((s) => s.id));
  const slug = String(title).toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 24);
  if (slug && !taken.has(slug)) return slug;
  return newId(slug ? slug + "-" : "s", taken);
}
const nextItemId = (items) => String(Math.max(0, ...items.map((it) => parseInt(it.id, 10) || 0)) + 1);
const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

// ------------------------------------------------------------------ plain text with light marking, to HTML and back
// **bold**, *italic*; an empty line starts a new paragraph; lines that begin with "- " make a list, with "1. " a numbered list.
const inlineToHtml = (t) => esc(t).replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>").replace(/\*([^*\n]+)\*/g, "<i>$1</i>").replace(/\n/g, "<br>");
export function textToHtml(text) {
  return String(text || "").replace(/\r/g, "").split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean).map((p) => {
    const lines = p.split("\n");
    if (lines.every((l) => /^[-•]\s+/.test(l))) return `<ul>${lines.map((l) => `<li>${inlineToHtml(l.replace(/^[-•]\s+/, ""))}</li>`).join("")}</ul>`;
    if (lines.every((l) => /^\d+[.)]\s+/.test(l))) return `<ol>${lines.map((l) => `<li>${inlineToHtml(l.replace(/^\d+[.)]\s+/, ""))}</li>`).join("")}</ol>`;
    return `<p>${inlineToHtml(p)}</p>`;
  }).join("\n");
}
function inlineFromNode(node) {
  let out = "";
  for (const n of node.childNodes) {
    if (n.nodeType === 3) { out += n.nodeValue.replace(/\s+/g, " "); continue; }
    if (n.nodeType !== 1) continue;
    const tag = n.tagName.toLowerCase();
    if (n.attributes.length) throw new Error("attributes");
    if (tag === "br") out += "\n";
    else if (tag === "b" || tag === "strong") out += `**${inlineFromNode(n)}**`;
    else if (tag === "i" || tag === "em") out += `*${inlineFromNode(n)}*`;
    else throw new Error("tag " + tag);
  }
  return out;
}
// children of an element back to marked text; throws when the HTML is richer than the editor can show
function blocksFromNode(el, skip = () => false) {
  const parts = [];
  for (const n of el.childNodes) {
    if (n.nodeType === 3) { if (n.nodeValue.trim()) throw new Error("loose text"); continue; }
    if (n.nodeType !== 1 || skip(n)) continue;
    const tag = n.tagName.toLowerCase();
    if (n.attributes.length) throw new Error("attributes");
    if (tag === "p") parts.push(inlineFromNode(n).trim());
    else if (tag === "ul") parts.push([...n.children].map((li) => "- " + inlineFromNode(li).trim()).join("\n"));
    else if (tag === "ol") parts.push([...n.children].map((li, i) => `${i + 1}. ` + inlineFromNode(li).trim()).join("\n"));
    else throw new Error("tag " + tag);
  }
  return parts.join("\n\n");
}
export const TEXT_STYLES = [
  ["plain", "Plain text"], ["rubric", "Instruction (highlighted)"], ["lead", "Lead-in line (italic)"], ["heading", "Heading of a step or part"],
  ["rtext", "Reading text"], ["rule", "Rule box"], ["note", "Note (grey box)"], ["discuss", "Questions to discuss (Talk about it)"], ["html", "My own HTML"],
];
export function htmlFromText({ style, title = "", sub = "", text = "", html = "" }) {
  const body = textToHtml(text);
  const one = (cls) => String(text || "").split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean).map((p) => `<p class="${cls}">${inlineToHtml(p)}</p>`).join("\n");
  if (style === "html") return html;
  if (style === "rubric") return one("rubric");
  if (style === "lead") return one("lead");
  if (style === "heading") return `<div class="sub-h"><h3>${inlineToHtml(title)}</h3>${sub ? `<p class="sub-h-s">${inlineToHtml(sub)}</p>` : ""}</div>`;
  if (style === "rtext") return `<div class="rtext">${title ? `<h3>${inlineToHtml(title)}</h3>` : ""}${body}</div>`;
  if (style === "rule") return `<div class="rule"><div class="rule-h"><span class="rule-tag">Rule</span>${inlineToHtml(title)}</div><div class="rule-b">${body}</div></div>`;
  if (style === "note") return `<div class="note">${body}</div>`;
  if (style === "discuss") {
    const qs = String(text || "").split("\n").map((l) => l.replace(/^\s*(\d+[.)]|[-•])\s+/, "").trim()).filter(Boolean);
    return `<div class="discuss"><div class="d-h"><span class="d-ic">?</span>${inlineToHtml(title || "Talk about it")}</div><ol>${qs.map((q) => `<li>${inlineToHtml(q)}</li>`).join("")}</ol></div>`;
  }
  return (title ? `<h3>${inlineToHtml(title)}</h3>\n` : "") + body;
}
// The reverse: which style a stored HTML block has. Anything richer than the editor makes is edited as "My own HTML".
export function textFromHtml(html) {
  const raw = { style: "html", html: String(html || "") };
  try {
    const d = new DOMParser().parseFromString(`<div id="r">${html}</div>`, "text/html").getElementById("r");
    const els = [...d.children];
    const loose = [...d.childNodes].some((n) => n.nodeType === 3 && n.nodeValue.trim());
    if (loose || !els.length) return raw;
    const cls = (e) => e.getAttribute("class") || "";
    const only = (e, c) => e.attributes.length === 1 && cls(e) === c;
    const bare = (e) => { const c = e.cloneNode(true); [...c.attributes].forEach((a) => c.removeAttribute(a.name)); return c; };
    if (els.every((e) => e.tagName === "P" && only(e, "rubric"))) return { style: "rubric", text: els.map((e) => inlineFromNode(bare(e)).trim()).join("\n\n") };
    if (els.every((e) => e.tagName === "P" && only(e, "lead"))) return { style: "lead", text: els.map((e) => inlineFromNode(bare(e)).trim()).join("\n\n") };
    if (els.length === 1 && els[0].tagName === "DIV") {
      const e = els[0];
      if (only(e, "note")) return { style: "note", text: blocksFromNode(e) };
      if (only(e, "sub-h")) {
        const h = e.querySelector(":scope > h3"), s = e.querySelector(":scope > p.sub-h-s");
        if (h && e.children.length === (s ? 2 : 1)) return { style: "heading", title: inlineFromNode(h).trim(), sub: s ? inlineFromNode(bare(s)).trim() : "" };
      }
      if (only(e, "rtext")) {
        const h = e.querySelector(":scope > h3");
        return { style: "rtext", title: h ? inlineFromNode(h).trim() : "", text: blocksFromNode(e, (n) => n === h) };
      }
      if (only(e, "rule")) {
        const h = e.querySelector(":scope > .rule-h"), b = e.querySelector(":scope > .rule-b");
        if (h && b && e.children.length === 2) {
          const hc = h.cloneNode(true); hc.querySelector(".rule-tag")?.remove(); [...hc.attributes].forEach((a) => hc.removeAttribute(a.name));
          return { style: "rule", title: inlineFromNode(hc).trim(), text: blocksFromNode(bare(b)) };
        }
      }
      if (only(e, "discuss")) {
        const h = e.querySelector(":scope > .d-h"), ol = e.querySelector(":scope > ol");
        if (h && ol && e.children.length === 2) {
          const hc = h.cloneNode(true); hc.querySelector(".d-ic")?.remove(); [...hc.attributes].forEach((a) => hc.removeAttribute(a.name));
          return { style: "discuss", title: inlineFromNode(hc).trim(), text: [...ol.children].map((li) => inlineFromNode(li).trim()).join("\n") };
        }
      }
      return raw;
    }
    const h = els[0].tagName === "H3" && !els[0].attributes.length ? els[0] : null;
    return { style: "plain", title: h ? inlineFromNode(h).trim() : "", text: blocksFromNode(d, (n) => n === h) };
  } catch { return raw; }
}

// ------------------------------------------------------------------ what can be added
const BLOCK_TYPES = [
  ["text", "Text", "Instruction, reading text, rule box, heading, questions to discuss"],
  ["ex-gap", "Gap fill", "Students type a word or a sentence"],
  ["ex-choice", "Choose from a list", "A dropdown with the options in each sentence"],
  ["ex-mcq", "Multiple choice", "A question with options A, B, C…"],
  ["ex-match", "Matching", "Match items with options from one list"],
  ["ex-open", "Open answer", "Writing, translation, own sentences: marked by you"],
  ["flashcards", "Flashcards", "Word, transcription, translation, example"],
  ["image", "Picture", "A file from the media folder"],
  ["audio", "Audio", "A recording to listen to"],
  ["video", "Video", "An embedded player (Rutube, YouTube…)"],
  ["teacher-note", "Teaching note", "Only you see it: aims, scripts, comments on the keys"],
];
function newBlock(type, u) {
  const ex = (kind, extra) => ({ type: "exercise", id: exId(u), kind, check: "teacher", title: "", rubric: "", items: [], ...extra });
  switch (type) {
    case "text": return { type: "html", html: "" };
    case "teacher-note": return { type: "teacher-note", html: "" };
    case "ex-gap": return ex("gap", { items: [{ id: "1", text: "", answer: "" }, { id: "2", text: "", answer: "" }] });
    case "ex-choice": return ex("gap", { items: [{ id: "1", text: "", choices: [], answer: "" }, { id: "2", text: "", choices: [], answer: "" }] });
    case "ex-mcq": return ex("mcq", { items: [{ id: "1", text: "", options: [], answer: "" }] });
    case "ex-match": return ex("match", { options: [{ id: "A", text: "" }, { id: "B", text: "" }, { id: "C", text: "" }], items: [{ id: "1", text: "", answer: "" }, { id: "2", text: "", answer: "" }] });
    case "ex-open": return ex("open", { max: 5, items: [{ id: "1", text: "", rows: 5 }] });
    case "flashcards": return { type: "flashcards", title: "", rubric: "", cards: [{ front: "", ipa: "", back: "", example: "" }, { front: "", ipa: "", back: "", example: "" }] };
    case "image": return { type: "image", src: "", alt: "", caption: "" };
    case "audio": return { type: "audio", src: "", title: "Listen", note: "" };
    case "video": return { type: "video", title: "Watch the video", src: "", url: "", site: "" };
  }
}
const typeOf = (b) => (b.type === "html" ? "text" : b.type === "exercise" ? (b.kind === "gap" && (b.items || []).some((it) => Array.isArray(it.choices)) ? "ex-choice" : "ex-" + b.kind) : b.type);
const KNOWN = new Set(BLOCK_TYPES.map((t) => t[0]));
const typeLabel = (b) => (BLOCK_TYPES.find((t) => t[0] === typeOf(b)) || [0, b.type])[1];

// ------------------------------------------------------------------ the editing form: fields bound to the draft by a path
const getPath = (o, path) => path.split(".").reduce((x, k) => (x == null ? undefined : x[k]), o);
function setPath(o, path, v) {
  const parts = path.split(".");
  let cur = o;
  for (const p of parts.slice(0, -1)) { if (cur[p] == null) cur[p] = {}; cur = cur[p]; }
  if (v === undefined) delete cur[parts.at(-1)]; else cur[parts.at(-1)] = v;
}
const altsToText = (a) => (Array.isArray(a) ? a.join("; ") : String(a ?? ""));
const textToAlts = (t) => { const l = String(t).split(";").map((x) => x.trim()).filter(Boolean); return l.length > 1 ? l : l[0] || ""; };
// lines with a star before the correct one
const starLines = (list, answer) => (list || []).map((c) => (c === answer ? "*" : "") + c).join("\n");

function F(label, path, o = {}) {
  const d = B.edit.draft, v = getPath(d, path);
  const a = `data-f="${esc(path)}" data-as="${o.as || "text"}"`;
  const hint = o.hint ? `<span class="bf-hint">${o.hint}</span>` : "";
  let ctl;
  if (o.as === "check") return `<label class="bf check ${o.cls || ""}"><input type="checkbox" ${a} ${(o.on !== undefined ? v === o.on : !!v) ? "checked" : ""} data-on="${esc(JSON.stringify(o.on ?? true))}" data-off="${esc(JSON.stringify(o.off ?? null))}"> <span>${label}${hint}</span></label>`;
  if (o.as === "select") ctl = `<select ${a}>${o.options.map(([val, t]) => `<option value="${esc(val)}" ${String(v ?? "") === String(val) ? "selected" : ""}>${esc(t)}</option>`).join("")}</select>`;
  else if (o.as === "area" || o.as === "lines" || o.as === "alts-area") ctl = `<textarea ${a} rows="${o.rows || 3}" placeholder="${esc(o.ph || "")}">${esc(o.as === "lines" ? (v || []).join("\n") : v ?? "")}</textarea>`;
  else if (o.as === "num") ctl = `<input type="number" ${a} value="${esc(v ?? "")}" min="${o.min ?? 0}" step="${o.step || 1}" style="width:7em">`;
  else ctl = `<input type="text" ${a} value="${esc(o.as === "alts" ? altsToText(v) : v ?? "")}" placeholder="${esc(o.ph || "")}">`;
  return `<label class="bf ${o.cls || ""}"><span class="bf-l">${label}</span>${ctl}${hint}</label>`;
}
// reads every field of the form into the draft
function syncForm() {
  if (!B.edit) return;
  B.root.querySelectorAll(".bld-form [data-f]").forEach((el) => {
    const as = el.dataset.as;
    let v = el.value;
    if (as === "check") v = JSON.parse(el.checked ? el.dataset.on : el.dataset.off);
    else if (as === "num") v = el.value === "" ? undefined : Number(el.value);
    else if (as === "lines") v = el.value.split("\n").map((x) => x.trim()).filter(Boolean);
    else if (as === "alts") v = textToAlts(el.value);
    if (v === null) v = undefined;
    setPath(B.edit.draft, el.dataset.f, v);
  });
}
const rowTools = (path, i, n) => `<span class="bf-rowtools">
  <button type="button" class="btn small" data-b="row-up" data-path="${path}" data-i="${i}" ${i ? "" : "disabled"} title="Move up">Up</button>
  <button type="button" class="btn small" data-b="row-down" data-path="${path}" data-i="${i}" ${i < n - 1 ? "" : "disabled"} title="Move down">Down</button>
  <button type="button" class="btn small danger" data-b="row-del" data-path="${path}" data-i="${i}" title="Delete this line">Delete</button></span>`;

const MARK_HINT = `You can mark words: <code>**bold**</code>, <code>*italic*</code>.`;
function formHTML() {
  const d = B.edit.draft, t = B.edit.type;
  let h = "";
  if (t === "text" || t === "teacher-note") {
    const s = d._t;
    if (t === "text") h += F("Kind of text", "_t.style", { as: "select", options: TEXT_STYLES, cls: "bf-style" });
    if (s.style === "html") h += F("HTML", "_t.html", { as: "area", rows: 10, hint: "For tables and anything the other kinds cannot do." });
    else {
      if (["heading", "rtext", "rule", "plain", "discuss"].includes(s.style)) h += F(s.style === "discuss" ? "Title of the box" : s.style === "plain" ? "Heading (can be empty)" : "Title", "_t.title", { ph: s.style === "discuss" ? "Talk about it" : "" });
      if (s.style === "heading") h += F("Line under the heading (can be empty)", "_t.sub");
      else h += F(s.style === "discuss" ? "Questions, one per line" : "Text", "_t.text", { as: "area", rows: s.style === "rtext" ? 14 : 6,
        hint: s.style === "discuss" ? MARK_HINT : `${MARK_HINT} An empty line starts a new paragraph. Lines that begin with <code>- </code> make a list, with <code>1. </code> a numbered list.` });
    }
    if (t === "teacher-note") h = `<p class="bf-note">Students never receive teaching notes: they are stored with the keys.</p>` + h;
  } else if (t.startsWith("ex-")) h = exerciseForm(d, t);
  else if (t === "flashcards") {
    h += F("Title", "title", { ph: "Flashcards: travelling" }) + F("Instruction (can be empty)", "rubric")
      + F("Cards with questions to discuss (one side only)", "style", { as: "check", on: "discussion" })
      + F("Give the deck an exercise number", "numbered", { as: "check" });
    const disc = d.style === "discussion";
    h += `<div class="bf-rows">` + (d.cards || []).map((c, i) => `<div class="bf-row"><span class="bf-n">${i + 1}</span><div class="bf-cols">
        ${F(disc ? "Question" : "Word or phrase", `cards.${i}.front`)}${disc ? "" : F("Transcription", `cards.${i}.ipa`, { ph: "/…/" }) + F("Translation or meaning", `cards.${i}.back`) + F("Example", `cards.${i}.example`)}
      </div>${rowTools("cards", i, d.cards.length)}</div>`).join("") + `</div>
      <button type="button" class="btn small" data-b="row-add" data-path="cards">Add a card</button>
      ${disc ? "" : `<p class="bf-hint">The words on the cards become the vocabulary of the unit.</p>`}`;
  } else if (t === "image") {
    h += F("File", "src", { ph: "media/u1/picture.jpg", hint: MEDIA_HINT }) + F("Caption (can be empty)", "caption") + F("Description for screen readers", "alt");
  } else if (t === "audio") {
    h += F("File", "src", { ph: "media/u1/listening-1.mp3", hint: MEDIA_HINT }) + F("Title", "title") + F("Note under the player (can be empty)", "note", { ph: "Two speakers · 2:34" })
      + `<p class="bf-hint">Put the script of the recording into a Teaching note: students must not receive it.</p>`;
  } else if (t === "video") {
    h += F("Title", "title") + F("Address of the player (embed link, starts with https://)", "src", { ph: "https://rutube.ru/play/embed/…", hint: "On the video site choose Share, then Embed, and copy the address from <code>src=\"…\"</code>." })
      + F("Page of the video (opened if the player does not load)", "url") + F("Name of the site", "site", { ph: "Rutube" });
  }
  if (!KNOWN.has(t)) h = `<p class="bf-note">This block was made in the course file and has no form here. You can change it as it is stored (JSON).</p>` + F("Block", "_json", { as: "area", rows: 12 });
  return h;
}
const MEDIA_HINT = `Upload the file to the folder <code>docs/media/</code> of your repository first (see the Setup guide, “Pictures, audio and video”), then type its path here. Use Latin letters without spaces in file names.`;

function exerciseForm(d, t) {
  let h = F("Title of the exercise", "title", { ph: "Complete the sentences" }) + F("Instruction", "rubric", { as: "area", rows: 2, hint: "You can use &lt;b&gt;bold&lt;/b&gt; and &lt;i&gt;italic&lt;/i&gt;." });
  const n = (d.items || []).length;
  const row = (i, inner) => `<div class="bf-row"><span class="bf-n">${esc(d.items[i].id)}</span><div class="bf-cols">${inner}</div>${rowTools("items", i, n)}</div>`;
  if (d.inline) h += `<p class="bf-note">This exercise has gaps inside a running text (made in the course file). Here you can change the answers; the text itself is in the field below.</p>` + F("Text with {{1}}, {{2}}… where the gaps are", "inline", { as: "area", rows: 8 });
  if (t === "ex-gap") {
    h += `<p class="bf-hint">Type three underscores <code>___</code> where the gap is. Several correct answers: separate them with a semicolon. In an answer, <code>(that)</code> is an optional word and <code>he/she</code> means either word. Capital letters, the final full stop and short forms (don't = do not) never matter.</p><div class="bf-rows">`
      + d.items.map((it, i) => row(i, F("Sentence", `items.${i}.text`, { ph: "She ___ (work) here since 2019." }) + F("Correct answer", `items.${i}.answer`, { as: "alts", ph: "has worked; has been working" }))).join("") + `</div>`;
  } else if (t === "ex-choice") {
    h += `<p class="bf-hint">Type <code>___</code> where the list appears. Write the options one per line, in the order students see them, and put a star <code>*</code> before the correct one.</p><div class="bf-rows">`
      + d.items.map((it, i) => row(i, F("Sentence", `items.${i}.text`, { ph: "Most children go to a ___ school." }) + F("Options (star = correct)", `items.${i}._opts`, { as: "area", rows: 3, ph: "*state\nprivate\npublic" }))).join("") + `</div>`;
  } else if (t === "ex-mcq") {
    h += `<p class="bf-hint">Write the options one per line (they become A, B, C…) and put a star <code>*</code> before the correct one. Vary the place of the correct option, and keep the options similar in length.</p><div class="bf-rows">`
      + d.items.map((it, i) => row(i, F("Question", `items.${i}.text`) + F("Options (star = correct)", `items.${i}._opts`, { as: "area", rows: 4, ph: "a first option\n*the correct option\na third option\na fourth option" }))).join("") + `</div>`;
  } else if (t === "ex-match") {
    const no = (d.options || []).length;
    h += `<div class="bf-sub">Options (the list students choose from)</div><div class="bf-rows">`
      + d.options.map((op, i) => `<div class="bf-row"><span class="bf-n">${esc(op.id)}</span><div class="bf-cols">${F("", `options.${i}.text`)}</div>${rowTools("options", i, no)}</div>`).join("")
      + `</div><button type="button" class="btn small" data-b="row-add" data-path="options">Add an option</button>
      <p class="bf-hint">Add one or two options that fit nothing: then the last answer cannot be guessed.</p>
      <div class="bf-sub">Items</div><div class="bf-rows">`
      + d.items.map((it, i) => row(i, F("Item", `items.${i}.text`) + F("Correct option", `items.${i}.answer`, { as: "select", options: [["", "choose…"], ...d.options.map((op) => [op.id, `${op.id}. ${String(op.text || "").replace(/<[^>]+>/g, "").slice(0, 40)}`])] }))).join("") + `</div>`;
  } else if (t === "ex-open") {
    h += `<div class="bf-rows">` + d.items.map((it, i) => row(i, F("Task or question", `items.${i}.text`, { as: "area", rows: 2 }) + F("Model answer (only you see it)", `items.${i}.answer`, { as: "area", rows: 2 })
        + F("Height of the answer field, lines", `items.${i}.rows`, { as: "num", min: 1 }))).join("") + `</div>`;
  }
  h += `<button type="button" class="btn small" data-b="row-add" data-path="items">Add ${t === "ex-mcq" ? "a question" : "an item"}</button>`;
  // how it is checked
  const open = t === "ex-open";
  h += `<div class="bf-sub">Checking</div>`
    + F(open ? "You give the marks for this task in Student work" : "Students see the results when I click “Check this exercise now” (otherwise when I release the results of the whole unit)", "check", { as: "check", on: "teacher", off: undefined })
    + F(open ? "Not marked (notes, a vocabulary file, personal goals)" : "No key: any answer is accepted and nothing is marked (a survey, opinions)", "graded", { as: "check", on: false, off: undefined });
  if (open) h += `<div class="bf-inline">` + F("Points for each item", "max", { as: "num", step: 0.5 }) + F("At least this many words (0 = no counter)", "minWords", { as: "num" }) + `</div>`;
  h += `<details class="bf-more" ${d._more ? "open" : ""}><summary>More options</summary>`
    + F("Words and phrases this task practises, one per line", "vocab", { as: "lines", rows: 3, hint: "Empty: the vocabulary of the unit (flashcards) is used." });
  if (t === "ex-gap") h += F("The answer is a whole sentence: wide field on its own line", "wide", { as: "check", off: undefined })
    + F("Short answers in small boxes (letters, T/F)", "box", { as: "check", off: undefined }) + F("Width of the field, characters", "size", { as: "num" })
    + F("Punctuation counts (comma exercises)", "punct", { as: "check", off: undefined });
  if (t === "ex-gap" || t === "ex-choice" || t === "ex-match") h += F("Items in two columns", "layout", { as: "check", on: "two", off: undefined });
  if (t === "ex-mcq") h += F("Options in two columns (short options)", "columns", { as: "check", on: 2, off: undefined });
  if (t === "ex-match") h += F("Show the option text in the dropdown without letters", "plain", { as: "check", off: undefined });
  if (!open) h += F("After the check, students see the correct answers", "showKey", { as: "select", options: [["", "Automatically: yes for words and options, no for whole sentences"], ["true", "Always"], ["false", "Never"]] });
  h += `</details>`;
  return h;
}

// draft <-> block
function toDraft(b) {
  const d = clone(b), t = typeOf(b);
  if (t === "text" || t === "teacher-note") {
    d._t = b.html ? textFromHtml(b.html) : { style: t === "text" ? "rubric" : "plain", text: "" };
    if (t === "teacher-note" && d._t.style !== "plain" && d._t.style !== "html") d._t = { style: "html", html: b.html };
    for (const k of ["title", "sub", "text", "html"]) d._t[k] ??= k === "html" ? b.html || "" : "";
  }
  if (t === "ex-choice") d.items.forEach((it) => { it._opts = starLines(it.choices, Array.isArray(it.answer) ? it.answer[0] : it.answer); });
  if (t === "ex-mcq") d.items.forEach((it) => { it._opts = (it.options || []).map((o, i) => (LETTERS[i] === it.answer ? "*" : "") + o).join("\n"); });
  if (t.startsWith("ex-")) { d.showKey = d.showKey === true ? "true" : d.showKey === false ? "false" : ""; }
  // a block made in the course file that has no form here (several pictures in a row…): edited as it is stored
  if (!KNOWN.has(t)) return { _json: JSON.stringify(b, null, 1) };
  return d;
}
function fromDraft(d, t) {
  const fail = (m) => { throw new Error(m); };
  if (!KNOWN.has(t)) { try { const j = JSON.parse(d._json); if (!j || typeof j !== "object" || !j.type) throw 0; return j; } catch { fail("The text is not valid JSON, or the block has no \"type\"."); } }
  const b = clone(d);
  const dropEmpty = (o, keys) => keys.forEach((k) => { if (o[k] === "" || o[k] === undefined || o[k] === null || (Array.isArray(o[k]) && !o[k].length)) delete o[k]; });
  if (t === "text" || t === "teacher-note") {
    const s = b._t; delete b._t;
    b.html = htmlFromText(s).trim();
    if (!b.html) fail("The text is empty.");
    return b;
  }
  if (t.startsWith("ex-")) {
    delete b._more;
    if (!String(b.title || "").trim()) fail("Give the exercise a title.");
    b.title = b.title.trim();
    if (!b.items?.length) fail("Add at least one item.");
    const keyed = b.graded !== false;
    b.items.forEach((it, i) => {
      const where = `Item ${i + 1}`;
      it.text = String(it.text || "").trim();
      if (!it.text && !b.inline) fail(`${where}: the ${t === "ex-mcq" ? "question" : "text"} is empty.`);
      if (t === "ex-gap") { delete it.choices; if (keyed && !altsToText(it.answer).trim()) fail(`${where}: type the correct answer.`); }
      if (t === "ex-choice" || t === "ex-mcq") {
        const lines = String(it._opts || "").split("\n").map((x) => x.trim()).filter(Boolean);
        delete it._opts;
        const star = lines.filter((l) => l.startsWith("*"));
        const opts = lines.map((l) => l.replace(/^\*\s*/, ""));
        if (opts.length < 2) fail(`${where}: write at least two options, one per line.`);
        if (new Set(opts).size !== opts.length) fail(`${where}: two options are the same.`);
        if (keyed && star.length !== 1) fail(`${where}: put a star * before the correct option (exactly one).`);
        const right = star[0]?.replace(/^\*\s*/, "");
        if (t === "ex-choice") { it.choices = opts; it.answer = right ?? ""; }
        else { if (opts.length > 8) fail(`${where}: no more than eight options.`); it.options = opts; it.answer = keyed ? LETTERS[opts.indexOf(right)] : ""; }
      }
      if (t === "ex-match" && keyed && !it.answer) fail(`${where}: choose the correct option.`);
      if (t === "ex-open") { dropEmpty(it, ["answer", "rows"]); }
      if (!keyed) delete it.answer;
    });
    if (t === "ex-match") {
      b.options = (b.options || []).map((o) => ({ ...o, text: String(o.text || "").trim() }));
      if (b.options.length < 2 || b.options.some((o) => !o.text)) fail("Matching needs at least two options, and no option may be empty.");
    }
    if (b.showKey === "true") b.showKey = true; else if (b.showKey === "false") b.showKey = false; else delete b.showKey;
    dropEmpty(b, ["rubric", "vocab", "size", "minWords", "check", "wide", "box", "punct", "layout", "columns", "plain"]);
    if (b.graded !== false) delete b.graded;
    if (t !== "ex-open") delete b.max;
    return b;
  }
  if (t === "flashcards") {
    b.cards = (b.cards || []).map((c) => Object.fromEntries(Object.entries(c).map(([k, v]) => [k, String(v || "").trim()]).filter(([, v]) => v))).filter((c) => c.front);
    if (!b.cards.length) fail("Add at least one card.");
    if (b.style !== "discussion") delete b.style;
    dropEmpty(b, ["rubric", "numbered", "title"]);
    return b;
  }
  if (t === "image" || t === "audio") { b.src = String(b.src || "").trim(); if (!b.src) fail("Type the path of the file, for example media/u1/file.jpg."); dropEmpty(b, ["alt", "caption", "note"]); return b; }
  if (t === "video") {
    b.src = String(b.src || "").trim();
    if (!/^https:\/\//.test(b.src)) fail("The address of the player must start with https://");
    dropEmpty(b, ["url", "site"]); return b;
  }
  return b;
}

// ------------------------------------------------------------------ drawing
const part = () => {
  const u = B.unit;
  if (!u) return null;
  if (B.part?.test) return (u.tests || []).find((t) => t.id === B.part.test) || null;
  return (u.sections || []).find((s) => s.id === B.part?.section) || null;
};
const blocksOf = (p) => (B.part?.test ? (p.exercises ??= []) : (p.blocks ??= []));
function touch() {
  B.dirty = true; B.msg = "";
  try { localStorage.setItem(draftKey(B.unit.id), JSON.stringify({ at: Date.now(), unit: B.unit })); } catch {}
}

function previewHTML(b, num) {
  try {
    if (b.type === "exercise") {
      const key = Object.fromEntries((b.items || []).filter((it) => it.answer !== undefined && it.answer !== "").map((it) => [String(it.id), it.answer]));
      const ex = { ...b, items: (b.items || []).map(({ answer, ...it }) => ({ ...it, id: String(it.id) })) };
      return renderExercise(ex, { num, readOnly: true, key });
    }
    if (b.type === "flashcards") return renderFlashcards(b, b.numbered ? num : "");
    return renderBlocks([b], () => ({}));
  } catch (e) { return `<p class="muted">This block cannot be shown: ${esc(e.message)}</p>`; }
}

function listHTML() {
  const units = B.api.units();
  const rows = units.map((u, i) => `<tr>
      <td class="num">${esc(u.order || i + 1)}</td>
      <td><b>${esc(u.title)}</b><div class="muted" style="font-size:12.5px">${(u.sections || []).map((s) => esc(s.title)).join(" · ") || "no sections yet"}</div></td>
      <td>${u.status === "soon" ? `<span class="pill off">coming soon</span>` : `<span class="pill on">ready</span>`}</td>
      <td style="white-space:nowrap"><button class="btn small primary" data-b="open" data-id="${esc(u.id)}">Edit</button>
        <button class="btn small" data-b="unit-up" data-id="${esc(u.id)}" ${i ? "" : "disabled"}>Up</button>
        <button class="btn small" data-b="unit-down" data-id="${esc(u.id)}" ${i < units.length - 1 ? "" : "disabled"}>Down</button>
        <button class="btn small" data-b="unit-file" data-id="${esc(u.id)}" title="Download this unit as a file (.json) with its keys: a backup, or a file to give to an AI assistant">File</button>
        <button class="btn small danger" data-b="unit-del" data-id="${esc(u.id)}">Delete</button></td></tr>`).join("");
  return `
  <div class="box"><h3 style="margin-top:0">Units of the course</h3>
    <p class="muted">A unit can be a module, a week or a topic. Each unit has sections (Reading, Grammar, Listening… you name them), and each section is built from blocks: texts, media and exercises.
      Students see a unit only after you open it for their group in <a href="#tools/access">Access &amp; results</a>.</p>
    <table class="t"><tr><th>#</th><th>Unit</th><th>Status</th><th></th></tr>${rows || `<tr><td colspan="4" class="muted">The course is empty. Add the first unit below, or add the sample unit to see how everything works.</td></tr>`}</table>
    <div class="row"><input type="text" id="bld-new-unit" placeholder="Title of the new unit" style="flex:1;min-width:220px"><button class="btn primary" data-b="unit-add">Add a unit</button></div>
  </div>
  <div class="box"><h3 style="margin-top:0">Sample unit and backup</h3>
    <div class="row"><button class="btn" data-b="sample">Add the sample unit</button><span class="muted">A short unit with every kind of block. Open it, try it as a student, then delete it.</span></div>
    <div class="row" style="margin-top:10px"><button class="btn" data-b="export">Download the whole course (.json)</button><span class="muted">A backup with all keys and notes. Keep it on your computer, not in the public repository. It can be imported again in <a href="#tools/content">Course content</a>.</span></div>
    <p id="bld-status" class="muted">${B.msg || ""}</p>
  </div>`;
}

function unitHTML() {
  const u = B.unit, p = part();
  const n = u.order || 1;
  const tabs = (u.sections || []).map((s, i) => `<button class="bld-tab ${!B.part.test && B.part.section === s.id ? "on" : ""}" data-b="part" data-section="${esc(s.id)}"><span class="n">${n}.${i + 1}</span> ${esc(s.title)}</button>`).join("")
    + `<button class="bld-tab add" data-b="sec-add">Add a section</button>`;
  const ttabs = (u.tests || []).map((t) => `<button class="bld-tab ${B.part.test === t.id ? "on" : ""}" data-b="part" data-test="${esc(t.id)}">⏱ ${esc(t.title)}</button>`).join("")
    + `<button class="bld-tab add" data-b="test-add">Add a timed test</button>`;
  let body = "";
  if (!p) body = `<div class="box muted">This unit has no sections yet. Click <b>Add a section</b>.</div>`;
  else {
    const isTest = !!B.part.test;
    const si = isTest ? -1 : u.sections.indexOf(p);
    const head = isTest
      ? `<div class="box bld-part"><div class="bld-partgrid">
          <label class="bf"><span class="bf-l">Title of the test</span><input type="text" data-p="title" value="${esc(p.title)}"></label>
          <label class="bf"><span class="bf-l">Time limit, minutes</span><input type="number" min="1" data-p="minutes" value="${esc(p.minutes)}" style="width:7em"></label>
          <label class="bf wide"><span class="bf-l">Instruction shown before the start</span><input type="text" data-p="rubric" value="${esc(p.rubric || "")}"></label></div>
          <div class="row"><span class="muted">A timed test is hidden until you open it in Tests. Each student's time runs from the moment they click Start.</span><span style="flex:1"></span><button class="btn small danger" data-b="test-del">Delete this test</button></div></div>`
      : `<div class="box bld-part"><div class="bld-partgrid">
          <label class="bf"><span class="bf-l">Title of the section</span><input type="text" data-p="title" value="${esc(p.title)}"></label>
          <label class="bf"><span class="bf-l">Subtitle (can be empty)</span><input type="text" data-p="subtitle" value="${esc(p.subtitle || "")}"></label></div>
          <div class="row"><button class="btn small" data-b="sec-up" ${si ? "" : "disabled"}>Move earlier</button><button class="btn small" data-b="sec-down" ${si < u.sections.length - 1 ? "" : "disabled"}>Move later</button>
          <span style="flex:1"></span><button class="btn small danger" data-b="sec-del">Delete this section</button></div></div>`;
    const blocks = blocksOf(p);
    let exN = 0;
    const cards = blocks.map((b, i) => {
      if (b.type === "exercise" || (b.type === "flashcards" && b.numbered)) exN++;
      const num = isTest ? String(exN) : `${n}.${si + 1}.${exN}`;
      const editing = B.edit && !B.edit.isNew && B.edit.index === i;
      return `<div class="bld-card ${editing ? "editing" : ""} ${b.type === "teacher-note" ? "tn" : ""}" data-i="${i}">
        <div class="bld-card-h"><span class="bld-type">${esc(typeLabel(b))}</span>${b.type === "exercise" ? `<code>${esc(b.id)}</code>` : ""}<span style="flex:1"></span>
          ${editing ? "" : `<button class="btn small primary" data-b="edit" data-i="${i}">Edit</button>
          <button class="btn small" data-b="blk-up" data-i="${i}" ${i ? "" : "disabled"}>Up</button>
          <button class="btn small" data-b="blk-down" data-i="${i}" ${i < blocks.length - 1 ? "" : "disabled"}>Down</button>
          <button class="btn small" data-b="blk-copy" data-i="${i}">Duplicate</button>
          <button class="btn small" data-b="add-menu" data-at="${i + 1}">Add below</button>
          <button class="btn small danger" data-b="blk-del" data-i="${i}">Delete</button>`}</div>
        ${editing ? editorHTML() : `<div class="bld-prev">${previewHTML(b, num)}</div>`}
      </div>${B.addAt === i + 1 && !B.edit ? addMenuHTML(i + 1) : ""}${B.edit?.isNew && B.edit.index === i + 1 ? `<div class="bld-card editing"><div class="bld-card-h"><span class="bld-type">New: ${esc(BLOCK_TYPES.find((t) => t[0] === B.edit.type)?.[1] || "")}</span></div>${editorHTML()}</div>` : ""}`;
    }).join("");
    const first = B.edit?.isNew && B.edit.index === 0 && !blocks.length ? `<div class="bld-card editing"><div class="bld-card-h"><span class="bld-type">New: ${esc(BLOCK_TYPES.find((t) => t[0] === B.edit.type)?.[1] || "")}</span></div>${editorHTML()}</div>` : "";
    const newAtTop = B.edit?.isNew && B.edit.index === 0 && blocks.length ? `<div class="bld-card editing"><div class="bld-card-h"><span class="bld-type">New: ${esc(BLOCK_TYPES.find((t) => t[0] === B.edit.type)?.[1] || "")}</span></div>${editorHTML()}</div>` : "";
    body = head + newAtTop + first + cards
      + (B.edit ? "" : !blocks.length ? addMenuHTML(0) : B.addAt === blocks.length ? "" : `<div class="bld-addrow"><button class="btn primary" data-b="add-menu" data-at="${blocks.length}">Add a block</button></div>`);
  }
  return `
  <div class="bld-top box">
    <div class="row"><button class="btn small" data-b="back">All units</button><span class="muted">Unit ${esc(n)}</span><code>${esc(u.id)}</code></div>
    <div class="bld-partgrid">
      <label class="bf"><span class="bf-l">Title of the unit</span><input type="text" data-u="title" value="${esc(u.title)}"></label>
      <label class="bf"><span class="bf-l">Status</span><select data-u="status"><option value="ready" ${u.status !== "soon" ? "selected" : ""}>Ready: can be opened for a group</option><option value="soon" ${u.status === "soon" ? "selected" : ""}>Coming soon: students see only the title</option></select></label>
    </div>
    ${B.restored ? `<p class="bf-note">Changes you had not saved (${esc(B.restored)}) are restored from this browser. Save them or click Discard my changes.</p>` : ""}
  </div>
  <div class="bld-tabs">${tabs}</div>
  <div class="bld-tabs tests">${ttabs}</div>
  ${body}
  <div class="bld-save ${B.dirty ? "dirty" : ""}">
    <span id="bld-state">${B.msg ? B.msg : B.dirty ? "You have changes that are not saved yet." : "Everything is saved."}</span><span style="flex:1"></span>
    <button class="btn" data-b="discard" ${B.dirty ? "" : "disabled"}>Discard my changes</button>
    <button class="btn primary" data-b="save" ${B.dirty ? "" : "disabled"}>Save and publish this unit</button>
  </div>`;
}
function addMenuHTML(at) {
  const list = B.part?.test ? BLOCK_TYPES.filter((t) => t[0].startsWith("ex-")) : BLOCK_TYPES;
  return `<div class="bld-menu box"><div class="row"><b>What do you want to add?</b><span style="flex:1"></span><button class="btn small" data-b="add-cancel">Cancel</button></div>
    <div class="bld-menu-grid">${list.map(([id, t, s]) => `<button class="bld-pick" data-b="add" data-type="${id}" data-at="${at}"><b>${t}</b><span>${s}</span></button>`).join("")}</div></div>`;
}
function editorHTML() {
  return `<form class="bld-form" onsubmit="return false">${formHTML()}
    <p class="bld-err" id="bld-err" hidden></p>
    <div class="row bld-form-btns"><button type="button" class="btn primary" data-b="apply">Done</button><button type="button" class="btn" data-b="cancel">Cancel</button>
    <span class="muted">Done keeps the block in your draft; nothing reaches students until you click Save and publish.</span></div></form>`;
}

function draw(keepScroll = true) {
  if (!B.root || !document.body.contains(B.root)) return;
  const y = window.scrollY;
  B.root.innerHTML = B.loading ? `<p class="muted">Loading…</p>` : B.unit ? unitHTML() : listHTML();
  if (keepScroll) window.scrollTo(0, y);
}

// ------------------------------------------------------------------ actions
function move(arr, i, d) { const j = i + d; if (j < 0 || j >= arr.length) return; [arr[i], arr[j]] = [arr[j], arr[i]]; }
const status = (html) => { B.msg = html; const el = B.root?.querySelector("#bld-status, #bld-state"); if (el) el.innerHTML = html; };
async function safe(fn) {
  try { await fn(); } catch (e) { console.error(e); status(`<b style="color:var(--bad)">${esc(e.message || String(e))}</b>`); B.api.toast("Error: " + (e.message || e), 7000); }
}
function confirmLeave() { return !B.dirty || confirm("You have changes that are not saved. Leave them in this browser and go on? (You can come back and save them later.)"); }

async function openUnit(id) {
  const meta = B.api.units().find((u) => u.id === id);
  if (!meta) return;
  B.loading = true; draw();
  let unit = await fetchUnit(meta), restored = false;
  const savedTests = unit.tests?.map((t) => t.id) || [];
  try {
    const d = JSON.parse(localStorage.getItem(draftKey(id)) || "null");
    if (d?.unit?.id === id) { unit = d.unit; unit.order = meta.order; restored = new Date(d.at).toLocaleString("en-GB", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }); }
  } catch {}
  B.savedTests = savedTests;
  Object.assign(B, { unitId: id, unit, dirty: !!restored, restored, loading: false, edit: null, addAt: null, msg: "" });
  B.part = unit.sections?.[0] ? { section: unit.sections[0].id } : unit.tests?.[0] ? { test: unit.tests[0].id } : {};
  draw(false); window.scrollTo(0, 0);
}
function closeUnit() { Object.assign(B, { unitId: null, unit: null, dirty: false, edit: null, addAt: null, restored: false, msg: "" }); draw(false); window.scrollTo(0, 0); }

async function renumber(list) {
  const batch = writeBatch(db);
  list.forEach((u, i) => { if (u.order !== i + 1) batch.update(doc(db, "units", u.id), { order: i + 1 }); });
  await batch.commit();
}
function download(name, text) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([text], { type: "application/json" }));
  a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

const ACT = {
  // ----- list of units
  "unit-add": () => safe(async () => {
    const inp = B.root.querySelector("#bld-new-unit"), title = inp.value.trim();
    if (!title) { inp.focus(); throw new Error("Type the title of the unit first."); }
    const units = B.api.units();
    const id = newId("u", new Set(units.map((u) => u.id)));
    await writeUnit({ id, order: Math.max(0, ...units.map((u) => Number(u.order) || 0)) + 1, title, status: "ready", sections: [] });
    B.api.toast("Unit added. Click Edit to fill it.");
  }),
  "unit-up": (b) => safe(async () => { const l = [...B.api.units()]; move(l, l.findIndex((u) => u.id === b.dataset.id), -1); await renumber(l); }),
  "unit-down": (b) => safe(async () => { const l = [...B.api.units()]; move(l, l.findIndex((u) => u.id === b.dataset.id), 1); await renumber(l); }),
  "unit-del": (b) => safe(async () => {
    const u = B.api.units().find((x) => x.id === b.dataset.id);
    if (!confirm(`Delete the unit “${u.title}” with its sections, exercises and keys?\nStudents' answers stay in the database, but nobody will see them without the unit.\nDownload the course first if you may need it again.`)) return;
    const tests = await getDocs(query(collection(db, "testContent"), where("unitId", "==", u.id)));
    const batch = writeBatch(db);
    ["units", "unitContent", "answerKeys"].forEach((c) => batch.delete(doc(db, c, u.id)));
    tests.docs.forEach((d) => batch.delete(doc(db, "testContent", d.id)));
    await batch.commit();
    try { localStorage.removeItem(draftKey(u.id)); } catch {}
    await renumber(B.api.units().filter((x) => x.id !== u.id));
    B.api.onSaved(u.id);
    B.api.toast("Unit deleted.");
  }),
  open: (b) => safe(() => openUnit(b.dataset.id)),
  sample: () => safe(async () => {
    const units = B.api.units();
    const id = newId("sample", new Set(units.map((u) => u.id)));
    await writeUnit({ ...clone(SAMPLE_UNIT), id, order: Math.max(0, ...units.map((u) => Number(u.order) || 0)) + 1 });
    B.api.onSaved(id);
    B.api.toast("The sample unit is added. Open it for a group in Access & results to see it as a student.", 7000);
  }),
  "unit-file": (b) => safe(async () => {
    const m = B.api.units().find((u) => u.id === b.dataset.id);
    download(`unit-${m.id}.json`, JSON.stringify({ units: [await fetchUnit(m)] }, null, 1));
    status(`Unit “${esc(m.title)}” is downloaded. The file contains the keys: do not publish it.`);
  }),
  export: () => safe(async () => {
    status("Collecting the units…");
    const units = [];
    for (const m of B.api.units()) units.push(await fetchUnit(m));
    download("course.json", JSON.stringify({ units }, null, 1));
    status(`Downloaded ${units.length} units at ${new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}. The file contains the keys: do not publish it.`);
  }),
  // ----- inside a unit
  back: () => { if (B.edit) { B.api.toast("Finish the block you are editing first (Done or Cancel)."); return; } if (confirmLeave()) closeUnit(); },
  part: (b) => { if (B.edit) { B.api.toast("Finish the block you are editing first (Done or Cancel)."); return; } B.part = b.dataset.test ? { test: b.dataset.test } : { section: b.dataset.section }; B.addAt = null; draw(false); },
  "sec-add": () => {
    if (B.edit) return;
    const title = prompt("Title of the new section (for example Reading, Grammar in Use, Listening):");
    if (!title?.trim()) return;
    const s = { id: sectionId(B.unit, title.trim()), title: title.trim(), blocks: [] };
    (B.unit.sections ??= []).push(s); B.part = { section: s.id }; touch(); draw(false);
  },
  "sec-up": () => { const s = B.unit.sections; move(s, s.indexOf(part()), -1); touch(); draw(); },
  "sec-down": () => { const s = B.unit.sections; move(s, s.indexOf(part()), 1); touch(); draw(); },
  "sec-del": () => {
    const p = part(), n = (p.blocks || []).length;
    if (!confirm(`Delete the section “${p.title}”${n ? ` with its ${n} blocks` : ""}?`)) return;
    B.unit.sections = B.unit.sections.filter((s) => s !== p);
    B.part = B.unit.sections[0] ? { section: B.unit.sections[0].id } : {};
    B.edit = null; touch(); draw(false);
  },
  "test-add": () => {
    if (B.edit) return;
    const title = prompt("Title of the timed test:", "Progress test");
    if (!title?.trim()) return;
    const t = { id: newId("t", new Set((B.unit.tests || []).map((x) => x.id))), title: title.trim(), minutes: 20, rubric: "", exercises: [] };
    (B.unit.tests ??= []).push(t); B.part = { test: t.id }; touch(); draw(false);
  },
  "test-del": () => {
    const p = part();
    if (!confirm(`Delete the test “${p.title}”?`)) return;
    B.unit.tests = B.unit.tests.filter((t) => t !== p);
    B.part = B.unit.sections?.[0] ? { section: B.unit.sections[0].id } : {};
    B.edit = null; touch(); draw(false);
  },
  "add-menu": (b) => { if (B.edit) return; B.addAt = Number(b.dataset.at); draw(); },
  "add-cancel": () => { B.addAt = null; draw(); },
  add: (b) => {
    const type = b.dataset.type, blk = newBlock(type, B.unit);
    B.edit = { index: Number(b.dataset.at), isNew: true, type, draft: toDraft(blk) };
    B.addAt = null; draw();
    B.root.querySelector(".bld-form input[type=text], .bld-form textarea")?.focus();
  },
  edit: (b) => { if (B.edit) return; const blk = blocksOf(part())[Number(b.dataset.i)]; B.edit = { index: Number(b.dataset.i), isNew: false, type: typeOf(blk), draft: toDraft(blk) }; draw(); },
  cancel: () => { B.edit = null; draw(); },
  apply: () => {
    syncForm();
    const err = B.root.querySelector("#bld-err");
    try {
      const blk = fromDraft(B.edit.draft, B.edit.type);
      const list = blocksOf(part());
      if (B.edit.isNew) list.splice(B.edit.index, 0, blk);
      else list[B.edit.index] = blk;
      B.edit = null; touch(); draw();
    } catch (e) { err.textContent = e.message; err.hidden = false; }
  },
  "blk-up": (b) => { if (B.edit) return; move(blocksOf(part()), Number(b.dataset.i), -1); touch(); draw(); },
  "blk-down": (b) => { if (B.edit) return; move(blocksOf(part()), Number(b.dataset.i), 1); touch(); draw(); },
  "blk-copy": (b) => {
    if (B.edit) return;
    const list = blocksOf(part()), c = clone(list[Number(b.dataset.i)]);
    if (c.type === "exercise") { c.id = exId(B.unit); c.title = (c.title || "") + " (copy)"; }
    list.splice(Number(b.dataset.i) + 1, 0, c); touch(); draw();
  },
  "blk-del": (b) => {
    if (B.edit) return;
    const list = blocksOf(part()), blk = list[Number(b.dataset.i)];
    if (!confirm(blk.type === "exercise" ? `Delete the exercise “${blk.title}”? Answers students have already given to it will no longer be shown.` : `Delete this block (${typeLabel(blk)})?`)) return;
    list.splice(Number(b.dataset.i), 1);
    touch(); draw();
  },
  "row-add": (b) => {
    syncForm();
    const d = B.edit.draft, path = b.dataset.path, t = B.edit.type;
    if (path === "cards") d.cards.push({ front: "", ipa: "", back: "", example: "" });
    else if (path === "options") d.options.push({ id: [...LETTERS].find((L) => !d.options.some((o) => String(o.id).toUpperCase() === L)) || "Z" + d.options.length, text: "" });
    else d.items.push({ id: nextItemId(d.items), text: "", ...(t === "ex-open" ? { rows: 5 } : { answer: "" }), ...(t === "ex-choice" || t === "ex-mcq" ? { _opts: "" } : {}) });
    d._more = B.root.querySelector(".bf-more")?.open; draw();
  },
  "row-del": (b) => { syncForm(); const d = B.edit.draft; getPath(d, b.dataset.path).splice(Number(b.dataset.i), 1); d._more = B.root.querySelector(".bf-more")?.open; draw(); },
  "row-up": (b) => { syncForm(); move(getPath(B.edit.draft, b.dataset.path), Number(b.dataset.i), -1); draw(); },
  "row-down": (b) => { syncForm(); move(getPath(B.edit.draft, b.dataset.path), Number(b.dataset.i), 1); draw(); },
  discard: () => {
    if (!confirm("Discard everything you changed in this unit since the last save?")) return;
    try { localStorage.removeItem(draftKey(B.unit.id)); } catch {}
    safe(() => openUnit(B.unit.id));
  },
  save: () => safe(async () => {
    if (B.edit) throw new Error("Finish the block you are editing first (Done or Cancel).");
    const u = B.unit;
    if (!String(u.title || "").trim()) throw new Error("The unit has no title.");
    for (const t of u.tests || []) if (!(Number(t.minutes) > 0)) throw new Error(`Test “${t.title}”: set the time limit in minutes.`);
    status("Saving…");
    await writeUnit(u, B.savedTests || []);
    B.savedTests = (u.tests || []).map((t) => t.id);
    try { localStorage.removeItem(draftKey(u.id)); } catch {}
    B.dirty = false; B.restored = false;
    B.api.onSaved(u.id);
    B.msg = `<b style="color:var(--ok)">✓ Saved and published at ${new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}.</b> Students who have the unit open see the changes after they reload the page.`;
    draw();
    B.api.toast("Unit saved.");
  }),
};

function onClick(e) {
  const b = e.target.closest("[data-b]");
  if (!b || !B.root.contains(b) || b.disabled) return;
  e.preventDefault();
  ACT[b.dataset.b]?.(b);
}
function onInput(e) {
  const el = e.target;
  if (el.dataset.u && B.unit) { B.unit[el.dataset.u] = el.value; touch(); markDirty(); }
  if (el.dataset.p && B.unit) {
    const p = part(); if (!p) return;
    const v = el.dataset.p === "minutes" ? Number(el.value) : el.value;
    if (el.dataset.p === "subtitle" && !v) delete p.subtitle; else p[el.dataset.p] = v;
    touch(); markDirty();
    if (el.dataset.p === "title") { const tab = B.root.querySelector(".bld-tab.on"); if (tab && !B.part.test) tab.lastChild.nodeValue = " " + el.value; }
  }
}
function onChange(e) {
  // the kind of text decides which fields the form has
  if (e.target.matches(".bld-form .bf-style select, .bld-form [data-f=style]")) { syncForm(); draw(); }
}
function markDirty() {
  B.root.querySelector(".bld-save")?.classList.add("dirty");
  B.root.querySelectorAll(".bld-save button").forEach((b) => (b.disabled = false));
  const s = B.root.querySelector("#bld-state"); if (s) s.textContent = "You have changes that are not saved yet.";
}

// ------------------------------------------------------------------ entry points for teacher.js
export const builderShell = () => `<div id="builder"></div>`;
export const builderBusy = () => !!(B.unit && B.root && document.body.contains(B.root));
export const builderDirty = () => B.dirty;
export function mountBuilder(root, api) {
  B.api = api;
  if (B.root !== root) {
    B.root = root;
    root.addEventListener("click", onClick);
    root.addEventListener("input", onInput);
    root.addEventListener("change", onChange);
  }
  draw(false);
}
// the list of units changed in the database: redraw the list (never an open unit)
export function builderRefresh() { if (B.root && document.body.contains(B.root) && !B.unit && !B.loading) draw(); }
window.addEventListener("beforeunload", (e) => { if (B.dirty && B.unit) { e.preventDefault(); e.returnValue = ""; } });

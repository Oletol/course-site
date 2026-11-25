// The settings of the course that every page shares: its title, the language being taught, the learners' first language
// and which automatic checks are switched on. The teacher changes them in Teacher's Edition, Course settings; they are kept
// in the database (settings/course) and remembered in the browser, so the title appears at once on the next visit.
// This file has no imports on purpose: any module may read CS and feat.

// Languages LanguageTool can check (https://languagetool.org). "none" = no automatic grammar check.
export const LANGS = [
  ["en-GB", "English (British)"], ["en-US", "English (American)"], ["de-DE", "German"], ["fr", "French"], ["es", "Spanish"],
  ["it", "Italian"], ["pt-PT", "Portuguese (Portugal)"], ["pt-BR", "Portuguese (Brazil)"], ["nl", "Dutch"], ["pl-PL", "Polish"],
  ["ru-RU", "Russian"], ["uk-UA", "Ukrainian"], ["sv", "Swedish"], ["da-DK", "Danish"], ["ca-ES", "Catalan"], ["el-GR", "Greek"],
  ["ro-RO", "Romanian"], ["zh-CN", "Chinese"], ["ja-JP", "Japanese"], ["ar", "Arabic"],
  ["none", "Another language or subject (no automatic grammar check)"],
];
// The learners' first language (LanguageTool uses it to find false friends). "" = mixed or not known.
export const FIRST_LANGS = [["", "Mixed or not known"], ["ru", "Russian"], ["en", "English"], ["de", "German"], ["fr", "French"], ["es", "Spanish"],
  ["it", "Italian"], ["pt", "Portuguese"], ["pl", "Polish"], ["uk", "Ukrainian"], ["nl", "Dutch"], ["zh", "Chinese"], ["ja", "Japanese"], ["ar", "Arabic"]];

export const DEFAULTS = {
  title: "",              // empty = COURSE_TITLE from firebase-config.js
  bookTitle: "Course Workbook",
  lang: "en-GB",
  firstLang: "ru",
  level: "",              // e.g. "B1–B2": told to the AI checker
  audience: "",           // e.g. "first-year students of economics": told to the AI checker
  grammarCheck: true,     // LanguageTool (and Harper for English)
  courseRules: true,      // extra rules for typical mistakes of Russian-speaking learners of English
  levels: true,           // CEFR vocabulary levels (English only)
  speech: true,           // speech turned into text by Whisper in the student's browser (English only)
};

const LS = "course:settings";
function cached() { try { return JSON.parse(localStorage.getItem(LS) || "{}") || {}; } catch { return {}; } }

export const CS = { ...DEFAULTS, ...cached() };

export function applySettings(data, remember = true) {
  for (const k of Object.keys(DEFAULTS)) if (data && data[k] !== undefined) CS[k] = data[k];
  if (remember) { try { localStorage.setItem(LS, JSON.stringify(CS)); } catch {} }
  return CS;
}

export const langName = (code = CS.lang) => (LANGS.find((l) => l[0] === code)?.[1] || code).replace(/ \(.*$/, "");
export const firstLangName = (code = CS.firstLang) => FIRST_LANGS.find((l) => l[0] === code)?.[1] || "";

// What works for the language of this course
export const feat = {
  english: () => /^en\b/i.test(CS.lang),
  languageTool: () => CS.grammarCheck !== false && CS.lang !== "none",
  harper: () => CS.grammarCheck !== false && feat.english(),
  courseRules: () => CS.courseRules !== false && feat.english() && CS.firstLang === "ru",
  unitGrammar: () => feat.english(),
  levels: () => CS.levels !== false && feat.english(),
  speech: () => CS.speech !== false && feat.english(),
};

// Loads and saves the course settings (settings/course in the database). See course-state.js.
import { db, doc, getDoc, setDoc } from "./fb.js?v=20261115d";
import { COURSE_TITLE } from "./firebase-config.js?v=20261115d";
import { CS, applySettings, DEFAULTS } from "./course-state.js?v=20261115d";

export { CS };
export const courseTitle = () => (CS.title || "").trim() || COURSE_TITLE || "My Course";

// Reads the settings once; calls onChange when they differ from what the browser remembered.
export async function loadSettings(onChange) {
  const before = JSON.stringify(CS);
  try {
    const snap = await getDoc(doc(db, "settings", "course"));
    if (snap.exists()) applySettings(snap.data());
  } catch (e) { console.warn("Course settings were not loaded", e); }
  if (JSON.stringify(CS) !== before && onChange) onChange(CS);
  return CS;
}

export async function saveSettings(patch) {
  const clean = Object.fromEntries(Object.keys(DEFAULTS).filter((k) => patch[k] !== undefined).map((k) => [k, patch[k]]));
  await setDoc(doc(db, "settings", "course"), clean, { merge: true });
  applySettings(clean);
  return CS;
}

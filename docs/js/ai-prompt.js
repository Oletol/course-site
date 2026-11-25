// The prompt a teacher gives to any AI assistant (ChatGPT, Gemini, Claude, DeepSeek…) to get a unit as a course file.
// Teacher's Edition, Import and export, "Copy the prompt". The format described here is the one Import accepts.
import { CS, langName, firstLangName } from "./course-state.js?v=20261115d";

export function aiPrompt() {
  const L = langName();
  const who = [CS.audience, CS.level ? `level ${CS.level}` : "", firstLangName() ? `first language ${firstLangName()}` : ""].filter(Boolean).join(", ");
  return `You are helping a teacher write one unit of an online ${L === "Another language or subject" ? "" : L + " "}course. The unit is stored as a JSON file that the course website imports.
${who ? `The learners: ${who}.\n` : ""}
MY REQUEST (the teacher fills this in):
- Topic of the unit: …
- Sections I want (for example Warm-up, Reading, Vocabulary, Grammar, Listening, Speaking, Writing): …
- Materials to use (paste texts, word lists, grammar points here, or write "create your own"): …
- Unit id and number: id "u1", order 1 (use the next free number for a new unit)

WHAT TO RETURN
Return one JSON object and nothing else: no comments, no explanations, no Markdown fence. It must be valid JSON (double quotes, no trailing commas).

{"units":[{"id":"u1","order":1,"title":"Title of the unit","status":"ready","sections":[
  {"id":"reading","title":"Reading","subtitle":"optional short line","blocks":[ …blocks… ]}
]}]}

Rules for ids: unit and section ids use Latin letters, digits and hyphens. Every exercise has an "id" that is unique in the whole unit ("q1", "q2", …). Items inside an exercise have ids "1", "2", "3"… as strings.

BLOCKS (the "blocks" array of a section, in the order students see them)

1. Text: {"type":"html","html":"…"} with one of these patterns
   instruction: <p class="rubric">Read the text and answer the questions.</p>
   heading of a step: <div class="sub-h"><h3>Step 1 · Words</h3><p class="sub-h-s">optional line</p></div>
   reading text: <div class="rtext"><h3>Title</h3><p>Paragraph…</p><p>Paragraph…</p></div>
   rule box: <div class="rule"><div class="rule-h"><span class="rule-tag">Rule</span>Title</div><div class="rule-b"><p>…</p><ul><li>…</li></ul></div></div>
   questions to discuss: <div class="discuss"><div class="d-h"><span class="d-ic">?</span>Talk about it</div><ol><li>…</li><li>…</li></ol></div>
   Allowed inside: <p>, <b>, <i>, <ul>, <ol>, <li>, <br>, <table class="g">.

2. Teaching note (only the teacher sees it: aims, scripts of recordings, comments on keys, sources of facts):
   {"type":"teacher-note","html":"<p>…</p>"}

3. Flashcards: {"type":"flashcards","title":"…","cards":[{"front":"word or phrase","ipa":"/transcription/","back":"translation or meaning","example":"A sentence with the word."}]}

4. Gap fill (the student types): 
   {"type":"exercise","id":"q1","kind":"gap","check":"teacher","title":"…","rubric":"…","items":[{"id":"1","text":"She ___ (work) here since 2019.","answer":"has worked"}]}
   Put ___ (three underscores) where the gap is. Several correct answers: "answer":["has worked","has been working"].
   A whole-sentence answer: add "wide":true to the exercise.

5. Choose from a list (a dropdown in the sentence): the same as gap fill, and each item has "choices":
   {"id":"1","text":"I need to ___ my notes.","choices":["repeat","revise","remind"],"answer":"revise"}

6. Multiple choice: {"type":"exercise","id":"q3","kind":"mcq","check":"teacher","title":"…","items":[{"id":"1","text":"Question?","options":["first","second","third"],"answer":"B"}]}
   "answer" is the letter of the correct option (A, B, C…).

7. Matching: {"type":"exercise","id":"q4","kind":"match","check":"teacher","title":"…","options":[{"id":"A","text":"…"},{"id":"B","text":"…"},{"id":"C","text":"…"}],"items":[{"id":"1","text":"…","answer":"B"}]}
   Give one or two options more than items.

8. Open answer (writing, translation, own sentences; the teacher marks it):
   {"type":"exercise","id":"q5","kind":"open","check":"teacher","max":10,"minWords":60,"title":"…","rubric":"…","items":[{"id":"1","text":"The task","rows":8,"answer":"A model answer, seen only by the teacher."}]}

9. Speaking timer with a voice recorder: {"type":"speaking","id":"sp1","label":"On your own · one minute","sec":60}

10. Picture: {"type":"image","src":"media/u1/picture.jpg","alt":"what is in the picture","caption":"optional"}
    Audio: {"type":"audio","src":"media/u1/listening-1.mp3","title":"Listen","note":"Two speakers"}
    I upload the files myself: invent short Latin file names and list them for me in a teaching note, with a description of each picture and the full script of each recording.

QUALITY RULES
- Every item of a gap, choice, multiple-choice or matching exercise must have its "answer". Check each key twice.
- Vary the position of the correct option; make the wrong options plausible and about as long as the correct one.
- Facts, names of studies and quotations must be real. If you are not sure, leave them out. List your sources in a teaching note.
- Do not put answers, scripts or keys into texts for students: only into "answer" fields and teaching notes.
- Keep the unit under about 150,000 characters. If it would be longer, stop and tell me to ask for the remaining sections separately.

IF I GIVE YOU AN EXISTING UNIT FILE TO CHANGE
Return the whole unit again with the changes made. Never change existing "id" values of the unit, sections, exercises or items (students' answers are attached to them); give new exercises new ids.`;
}

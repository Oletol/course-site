// Setup guide (setup.html): takes a new teacher through Firebase and GitHub step by step and checks each step where it can.
// The page never writes to the database. It reads firebase-config.js, tries to reach the database, and lets the teacher
// sign in once to see whether the teacher account is registered.
import { firebaseConfig } from "./firebase-config.js?v=20261115d";

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const configured = !!firebaseConfig?.apiKey && !/^PASTE/i.test(firebaseConfig.apiKey) && firebaseConfig.projectId !== "your-project";
const host = location.hostname;
const onPages = /\.github\.io$/.test(host);
const user = onPages ? host.replace(/\.github\.io$/, "") : "YOUR-LOGIN";
const repo = onPages ? location.pathname.split("/").filter(Boolean)[0] || "YOUR-REPOSITORY" : "YOUR-REPOSITORY";
const gh = `https://github.com/${user}/${repo}`;
const consoleUrl = configured ? `https://console.firebase.google.com/project/${firebaseConfig.projectId}` : "https://console.firebase.google.com";
const S = { fb: null, rules: null, auth: null, uid: "", teacher: null, email: "", rulesShown: false };
// The rules are loaded with the page, so that Copy works at once (Safari refuses to copy after a wait).
let RULES = "";
fetch("firestore.rules.txt", { cache: "no-store" }).then((r) => (r.ok ? r.text() : "")).then((t) => { RULES = t; const el = document.querySelector("#rules-text"); if (el) el.value = t; }).catch(() => {});
function copyText(text, field) {
  // the modern way first; if the browser refuses, select the text in a field and use the old command
  const old = () => { if (!field) return false; field.hidden = false; field.focus(); field.select(); try { return document.execCommand("copy"); } catch { return false; } };
  if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(text).then(() => true, () => old());
  return Promise.resolve(old());
}

const badge = (st) => st === true ? `<span class="st ok">✓ Done</span>` : st === false ? `<span class="st bad">Not yet</span>` : st === "wait" ? `<span class="st">Checking…</span>` : `<span class="st">Check it yourself</span>`;
const step = (n, title, st, body) => `<section class="box setup-step ${st === true ? "ok" : ""}"><h3><span class="sn">${n}</span>${title}${badge(st)}</h3>${body}</section>`;

function draw() {
  const keep = { cfg: $("#cfg-in")?.value, em: $("#su-email")?.value, pw: $("#su-pass")?.value };
  $("#setup").innerHTML = [
    step(1, "Your own copy of the course on GitHub", onPages ? true : null, `
      <ol><li>Sign in to <a href="https://github.com" target="_blank" rel="noopener">github.com</a> (create a free account if you have none).</li>
      <li>Click <b>New repository</b>. Give it a short Latin name without spaces (it becomes part of the address of your course), choose <b>Public</b> and click <b>Create repository</b>.</li>
      <li>Unpack the zip file you downloaded from the workshop page. In your new repository click <b>uploading an existing file</b>, drag the <b>docs</b> folder and the file <b>firestore.rules</b> into the page, and click <b>Commit changes</b>.</li>
      <li>In your repository open <b>Settings</b>, then <b>Pages</b>. Under <b>Build and deployment</b> choose <b>Deploy from a branch</b>, branch <b>main</b>, folder <b>/docs</b>, and click <b>Save</b>.</li>
      <li>In two or three minutes the site is at <code>https://${esc(user)}.github.io/${esc(repo)}/</code>. Open <code>…/setup.html</code> there and go on from that page: it will then check the next steps for you.</li></ol>
      ${onPages ? `<p class="ok-line">This page is open from GitHub Pages: <code>${esc(host)}</code>.</p>` : `<p class="muted">This page is not open from GitHub Pages now (${esc(host || "a local file")}), so some links below show YOUR-LOGIN.</p>`}`),

    step(2, "A Firebase project and its keys", configured, `
      <p class="muted">If you typed your Firebase keys into the workshop page before you downloaded the files, this step is already green and you can go to step 3. Use the form below to move the course to another Firebase project.</p>
      <ol><li>Open the <a href="https://console.firebase.google.com" target="_blank" rel="noopener">Firebase console</a> and click <b>Create a project</b> (or Add project). Any name; Google Analytics may be switched off. The free <b>Spark</b> plan is enough: do not upgrade.</li>
      <li>On the project page click the web icon <b>&lt;/&gt;</b> (Add app, Web). Any nickname; do <b>not</b> tick Firebase Hosting. Click <b>Register app</b>.</li>
      <li>Firebase shows a piece of code with <code>const firebaseConfig = { … }</code>. Copy it and paste it here:</li></ol>
      <textarea id="cfg-in" rows="9" class="json" placeholder='const firebaseConfig = {&#10;  apiKey: "AIza…",&#10;  authDomain: "my-course.firebaseapp.com",&#10;  projectId: "my-course",&#10;  …&#10;};'></textarea>
      <div class="row"><input type="text" id="cfg-title" placeholder="Title of your course" style="flex:1;min-width:200px"><button class="btn primary" id="cfg-make">Make my settings file</button></div>
      <div id="cfg-out"></div>
      ${configured ? `<p class="ok-line">The course is connected to the Firebase project <code>${esc(firebaseConfig.projectId)}</code>.</p>` : `<p class="muted">Now the file <code>docs/js/firebase-config.js</code> still has the placeholder values.</p>`}`),

    step(3, "Sign-in with email and password", S.auth === null ? null : S.auth, `
      <ol><li>In the <a href="${consoleUrl}/authentication/providers" target="_blank" rel="noopener">Firebase console</a> open <b>Build</b>, then <b>Authentication</b>, and click <b>Get started</b>.</li>
      <li>On the tab <b>Sign-in method</b> choose <b>Email/Password</b>, switch on the <b>first</b> switch only, and click <b>Save</b>.</li>
      <li>On the tab <b>Settings</b>, under <b>Authorized domains</b>, click <b>Add domain</b> and type <code>${esc(user)}.github.io</code>.</li></ol>
      <p class="muted">Do not add any users yet: you create your own teacher account in <b>step 5</b>, after the database is ready. This step is checked there too, when you sign in.</p>`),

    step(4, "The database and its safety rules", !configured ? false : S.rules === null ? "wait" : S.rules, `
      <ol><li>In the Firebase console open <b>Build</b>, then <b>Firestore Database</b>, and click <b>Create database</b>. Choose a location near your students (for Europe, for example, <code>europe-west3</code>) and <b>Start in production mode</b>. If the wizard offers scheduled backups on a paid plan, leave them unticked. Click <b>Create</b>.</li>
      <li>Open the tab <b>Rules</b>. Delete everything in the editor, paste the rules of this course (the button below copies them) and click <b>Publish</b>.</li></ol>
      <div class="row"><button class="btn primary" id="rules-copy">Copy the rules</button><button class="btn" id="rules-show">Show the rules</button><button class="btn" id="rules-check" ${configured ? "" : "disabled"}>Check again</button><span id="rules-status" class="muted"></span></div>
      <textarea id="rules-text" class="json" rows="12" readonly ${S.rulesShown ? "" : "hidden"}>${esc(RULES)}</textarea>
      <p class="muted">The rules are what keeps the answer keys away from students and each student's work away from the others. ${S.rules === false ? `<b style="color:var(--bad)">The database did not answer as expected${S.rulesErr ? ` (${esc(S.rulesErr)})` : ""}: it is not created yet, or the rules of this course are not published.</b>` : ""}</p>`),

    step(5, "Your teacher account", S.teacher, `
      <p>A teacher is an ordinary account that you also write into the list <code>teachers</code> in the database. Only the owner of the Firebase project can do that, so students cannot make themselves teachers.</p>
      <ol><li><b>Create the account.</b> In the Firebase console open <a href="${consoleUrl}/authentication/users" target="_blank" rel="noopener">Authentication</a>, tab <b>Users</b>, and click <b>Add user</b>. Type your email and a password (six characters or more) and click <b>Add user</b>.</li>
      <li><b>Copy the User UID.</b> The new user appears in the table. The last column, <b>User UID</b>, is a long code: point at it and click the copy icon. (Or sign in below: the page shows the UID too.)</li>
      <li><b>Register the account as a teacher.</b> Open <a href="${consoleUrl}/firestore/data" target="_blank" rel="noopener">Firestore Database</a>, tab <b>Data</b>, and click <b>Start collection</b>.
        Collection ID: <code>teachers</code>, then <b>Next</b>. Document ID: paste the UID. Field: <code>name</code>, type <b>string</b>, value: your name. Click <b>Save</b>.</li>
      <li><b>Check.</b> Sign in here with the same email and password.</li></ol>
      <div class="row"><input type="email" id="su-email" placeholder="Email" autocomplete="username"><input type="password" id="su-pass" placeholder="Password" autocomplete="current-password"><button class="btn primary" id="su-go" ${configured ? "" : "disabled"}>Sign in and check</button></div>
      <div id="su-out">${S.uid ? uidHTML() : S.authErr ? `<p class="bad-line">${esc(S.authErr)}</p>` : ""}</div>`),

    step(6, "First visit to Teacher's Edition", null, `
      <ol><li>Open <a href="teacher.html" target="_blank">Teacher's Edition</a> and sign in.</li>
      <li><b>Course settings</b>: the title of the course, the language you teach, the automatic checks.</li>
      <li><b>Groups &amp; students</b>: create a group. Its code is what students type when they create their accounts on the <a href="index.html" target="_blank">student page</a>.</li>
      <li><b>Course builder</b>: click <b>Add the sample unit</b> to see every kind of block, then build your own units, sections and exercises.</li>
      <li><b>Access &amp; results</b>: open a unit for the group. Students see it at once.</li></ol>
      <p class="muted">Student page: <code>https://${esc(user)}.github.io/${esc(repo)}/</code> · Teacher's Edition: <code>…/teacher.html</code>. A second teacher is added as in step 5.</p>`),

    step(7, "Pictures, audio and video", null, `
      <p>Media files live in your repository, in the folder <code>docs/media/</code>. Make one folder per unit.</p>
      <ol><li>On GitHub open your repository, go into <code>docs/media</code>, click <b>Add file</b>, then <b>Upload files</b>, drag the files in and click <b>Commit changes</b>. To make a new folder, click <b>Add file</b>, <b>Create new file</b> and type <code>u1/readme.txt</code> as the name.</li>
      <li>In Course builder add a Picture or Audio block and type the path, for example <code>media/u1/city.jpg</code>.</li></ol>
      <p class="muted">Use Latin letters, digits and hyphens in file names. Shrink pictures to about 1400 pixels wide. Everything in the repository is public, so never put answer keys or scripts of recordings there: keys are typed in Course builder and stay in the database. One file must be under 100 MB; for video, embed a player from a video site.</p>`),

    `<section class="box"><h3 style="margin-top:0">What the course records</h3>
      <p class="muted" style="margin:0">Each student's answers and drafts with the time of the last change, exercises marked Done, results of every check, timed tests, texts with their feedback, recordings turned into text (English courses), your In-Class and HA marks and the attendance. Students' recordings themselves never leave their browsers. The free Firebase plan allows 50,000 reads and 20,000 writes a day and 1 GB of data, which is enough for several groups. Tell your students what is collected, and ask for their consent before you use their texts in research.</p></section>`,
  ].join("");
  if (keep.cfg) $("#cfg-in").value = keep.cfg;
  if (keep.em) $("#su-email").value = keep.em;
  if (keep.pw) $("#su-pass").value = keep.pw;
}
const uidHTML = () => `<p class="${S.teacher ? "ok-line" : "bad-line"}">Signed in as <b>${esc(S.email)}</b>. Your User UID: <code id="su-uid">${esc(S.uid)}</code> <button class="btn small" id="uid-copy">Copy</button></p>`
  + (S.teacher ? `<p class="ok-line">This account is registered as a teacher. You can open Teacher's Edition.</p>`
    : `<p>This account is <b>not registered as a teacher yet</b>: do part 3 of this step with the UID above (the Document ID must be exactly this UID, without spaces), then click <b>Sign in and check</b> again. If the collection <code>teachers</code> already exists, open it and click <b>Add document</b>.</p>`);

// the firebaseConfig object pasted from the console, read without running it as code
function parseConfig(text) {
  const out = {};
  for (const k of ["apiKey", "authDomain", "projectId", "storageBucket", "messagingSenderId", "appId", "measurementId"]) {
    const m = text.match(new RegExp(`["']?${k}["']?\\s*:\\s*["']([^"']+)["']`));
    if (m) out[k] = m[1].trim();
  }
  for (const k of ["apiKey", "authDomain", "projectId", "appId"]) if (!out[k]) throw new Error(`I cannot find “${k}” in the text. Copy the whole block from const firebaseConfig = { to the closing }.`);
  return out;
}
function configFile(cfg, title) {
  return `// Firebase settings of this course (made by the Setup guide).
// These values are not secret: the data are protected by the Firestore rules.
const firebaseConfig = ${JSON.stringify(cfg, null, 2).replace(/"(\w+)":/g, "$1:")};

export { firebaseConfig };

// The first name of the course: shown until you set the title in Teacher's Edition, Course settings.
export const COURSE_TITLE = ${JSON.stringify(title || "My Course")};
`;
}

async function fb() { return (S.fb ??= await import("./fb.js?v=20261115d")); }
async function checkRules() {
  if (!configured) return;
  S.rules = null; draw();
  try {
    const f = await fb();
    // the rules of this course let everybody read settings/course; default rules refuse it, and a missing database fails too
    await Promise.race([f.getDocFromServer ? f.getDocFromServer(f.doc(f.db, "settings", "course")) : f.getDoc(f.doc(f.db, "settings", "course")),
      new Promise((_, rej) => setTimeout(() => rej(new Error("no answer in 15 seconds")), 15000))]);
    S.rules = true;
  } catch (e) { S.rules = false; S.rulesErr = e.code || e.message; }
  draw();
}
async function signIn() {
  const email = $("#su-email").value.trim(), pass = $("#su-pass").value;
  S.authErr = ""; S.uid = "";
  try {
    const f = await fb();
    const cred = await f.signInWithEmailAndPassword(f.auth, email, pass);
    S.auth = true; S.uid = cred.user.uid; S.email = cred.user.email;
    const t = await f.getDoc(f.doc(f.db, "teachers", S.uid)).catch(() => null);
    S.teacher = !!t?.exists();
  } catch (e) {
    const c = e.code || "";
    if (c === "auth/operation-not-allowed" || c === "auth/configuration-not-found") { S.auth = false; S.authErr = "Email/Password sign-in is not switched on yet (step 3)."; }
    else if (c === "auth/api-key-not-valid" || /api-key/.test(c)) { S.authErr = "The API key is not valid: make the settings file again (step 2)."; }
    else if (/invalid-credential|wrong-password|user-not-found|invalid-email/.test(c)) { S.auth = true; S.authErr = "Sign-in works, but this email or password is not right. Add the user in Authentication, Users, or check the password."; }
    else S.authErr = `It did not work: ${c || e.message}`;
    S.teacher = false;
  }
  draw();
}

document.addEventListener("click", async (e) => {
  const id = e.target.id;
  if (id === "cfg-make") {
    const out = $("#cfg-out");
    try {
      const file = configFile(parseConfig($("#cfg-in").value), $("#cfg-title").value.trim());
      out.innerHTML = `<p><b>Your file is ready.</b> Now put it into your repository:</p>
        <ol><li>Click <b>Copy the file</b>.</li>
        <li>Open <a href="${gh}/edit/main/docs/js/firebase-config.js" target="_blank" rel="noopener">docs/js/firebase-config.js in your repository</a> (the pencil icon opens the editor).</li>
        <li>Select everything in the editor, delete it, paste, and click <b>Commit changes</b>.</li>
        <li>Wait two or three minutes and reload this page with Ctrl+Shift+R (Mac: Cmd+Shift+R). Step 2 turns green.</li></ol>
        <div class="row"><button class="btn primary" id="cfg-copy">Copy the file</button><span id="cfg-copied" class="muted"></span></div>
        <textarea id="cfg-file" rows="14" class="json" readonly>${esc(file)}</textarea>`;
    } catch (err) { out.innerHTML = `<p class="bad-line">${esc(err.message)}</p>`; }
  }
  if (id === "cfg-copy") { const ok = await copyText($("#cfg-file").value, $("#cfg-file")); $("#cfg-copied").textContent = ok ? "Copied." : "The text is selected: press Ctrl+C (Mac: Cmd+C)."; }
  if (id === "rules-copy") {
    if (!RULES) { $("#rules-status").textContent = "The rules are not loaded yet. Reload the page and try again."; return; }
    const ok = await copyText(RULES, $("#rules-text"));
    if (!ok) S.rulesShown = true;
    $("#rules-status").textContent = ok ? "Copied. Paste them into the Rules tab and click Publish." : "The rules are selected below: press Ctrl+C (Mac: Cmd+C), then paste them into the Rules tab.";
  }
  if (id === "rules-show") { S.rulesShown = !S.rulesShown; $("#rules-text").hidden = !S.rulesShown; }
  if (id === "rules-check") checkRules();
  if (id === "su-go") signIn();
  if (id === "uid-copy") copyText(S.uid, null);
});

draw();
checkRules();

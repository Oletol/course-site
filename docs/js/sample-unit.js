// The sample unit: one short unit with every kind of block, to show a new teacher how the course works.
// Course builder, "Add the sample unit" saves it to the database like any other unit; it can be edited and deleted.
export const SAMPLE_UNIT = {
  id: "sample", order: 1, title: "Sample unit · Study habits", status: "ready",
  sections: [
    { id: "start", title: "Start here", subtitle: "Words and warm-up", blocks: [
      { type: "teacher-note", html: "<p><b>This is a teaching note.</b> Only you see it. Use notes for aims, timing, scripts of recordings and comments on the keys.</p><p>Open this unit for a group in Access &amp; results, then sign in as a student (in another browser or a private window) to see the student's book.</p>" },
      { type: "html", html: "<div class=\"sub-h\"><h3>Step 1 · The words you need</h3><p class=\"sub-h-s\">How we study</p></div>" },
      { type: "html", html: "<p class=\"rubric\">Read the cards. Try to say what each phrase means before you turn the card.</p>" },
      { type: "flashcards", title: "Flashcards. Study habits", cards: [
        { front: "meet a deadline", ipa: "/ˌmiːt ə ˈdedlaɪn/", back: "to finish a piece of work by the agreed time", example: "She always starts early, so she never has trouble meeting a deadline." },
        { front: "put something off", ipa: "/ˌpʊt ˈɒf/", back: "to decide to do something later than planned", example: "I kept putting the essay off until the last evening." },
        { front: "take a break", ipa: "/ˌteɪk ə ˈbreɪk/", back: "to stop working for a short time", example: "After an hour of reading, take a break and walk around." },
        { front: "distraction", ipa: "/dɪˈstrækʃn/", back: "something that takes your attention away from your work", example: "For many students the phone is the biggest distraction." },
        { front: "revise", ipa: "/rɪˈvaɪz/", back: "to study again something you have learnt, before an exam", example: "We revised the whole unit before the test." },
      ] },
      { type: "exercise", id: "q1", kind: "gap", check: "teacher", title: "Complete the sentences", rubric: "Write <b>one word</b> in each gap. The first letter is given in the sentence.",
        items: [
          { id: "1", text: "I can never m___ a deadline if I start on the last day.", answer: "meet" },
          { id: "2", text: "Stop putting it o___ and write the first paragraph now.", answer: "off" },
          { id: "3", text: "Let's take a b___ and have some tea.", answer: "break" },
          { id: "4", text: "Background music is a d___ for me, so I study in silence.", answer: "distraction" },
        ] },
      { type: "exercise", id: "q2", kind: "gap", check: "teacher", title: "Choose the correct word",
        items: [
          { id: "1", text: "I need to ___ my notes before the exam.", choices: ["repeat", "revise", "remind"], answer: "revise" },
          { id: "2", text: "She ___ a short break every forty minutes.", choices: ["takes", "makes", "does"], answer: "takes" },
          { id: "3", text: "We must hand the report in by Friday. That is the ___.", choices: ["dead end", "timetable", "deadline"], answer: "deadline" },
        ] },
      { type: "html", html: "<div class=\"discuss\"><div class=\"d-h\"><span class=\"d-ic\">?</span>Talk about it</div><ol><li>What do you usually <b>put off</b>? Why?</li><li>What is your biggest <b>distraction</b> when you study?</li></ol></div>" },
    ] },
    { id: "reading", title: "Reading", subtitle: "A text with tasks", blocks: [
      { type: "image", src: "media/sample/desk.svg", alt: "A desk with a laptop, a notebook and a kitchen timer", caption: "Pictures are files in the media folder of your repository." },
      { type: "html", html: "<div class=\"rtext\"><h3>Twenty-five minutes at a time</h3><p>In the late 1980s an Italian student, Francesco Cirillo, could not concentrate on his books. He took a kitchen timer shaped like a tomato and promised himself to study without stopping until it rang. The method he later described is known as the Pomodoro Technique, from the Italian word for tomato.</p><p>The idea is simple. You choose one task, set a timer for twenty-five minutes and work on that task only. When the timer rings, you take a short break of about five minutes. After four such periods you take a longer break.</p><p>People who use the method say that a short, fixed period makes it easier to begin, and that regular breaks help them to stay fresh. Others find that the timer interrupts them just when the work is going well.</p></div>" },
      { type: "exercise", id: "q3", kind: "mcq", check: "teacher", title: "Choose the best answer", rubric: "Choose the answer (A, B or C) that fits the text.",
        items: [
          { id: "1", text: "Why did Cirillo start using a timer?", options: ["He wanted to cook while he studied.", "He found it hard to keep his attention on his studies.", "His teacher asked every student to use one."], answer: "B" },
          { id: "2", text: "What happens after four working periods?", options: ["There is a longer break.", "The task is changed for a new one.", "The timer is set for fifty minutes."], answer: "A" },
          { id: "3", text: "What do some people dislike about the method?", options: ["The breaks are too long to stay fresh.", "It is difficult to choose only one task.", "The timer can stop them at a good moment."], answer: "C" },
        ] },
      { type: "exercise", id: "q4", kind: "match", check: "teacher", title: "Match the two halves", rubric: "Match each beginning with its ending. There is one ending you do not need.",
        options: [{ id: "A", text: "for twenty-five minutes." }, { id: "B", text: "from the Italian word for tomato." }, { id: "C", text: "of about five minutes." }, { id: "D", text: "with a second timer." }],
        items: [{ id: "1", text: "The technique takes its name", answer: "B" }, { id: "2", text: "You set the timer", answer: "A" }, { id: "3", text: "Then you take a short break", answer: "C" }] },
      { type: "teacher-note", html: "<p><b>Source of the facts in the text:</b> Francesco Cirillo, <i>The Pomodoro Technique</i> (the method was developed in the late 1980s; the name comes from a tomato-shaped kitchen timer).</p>" },
    ] },
    { id: "speak-write", title: "Writing", subtitle: "A short text you mark yourself", blocks: [
      { type: "exercise", id: "q6", kind: "open", check: "teacher", max: 10, minWords: 60, title: "Write a short message", rubric: "A friend has asked you how to prepare for an exam without stress. Write a message with your advice (<b>60–80 words</b>). Use at least three phrases from the flashcards.",
        items: [{ id: "1", text: "Your message", rows: 8, answer: "Hi Lena, start revising two weeks before the exam and do a little every day. Choose one topic, set a timer for twenty-five minutes and take a break when it rings. Put your phone away, because it is the biggest distraction. Do not put off the most difficult topic until the last day. If you plan your time, you will meet every deadline and still sleep well. Good luck!" }] },
    ] },
  ],
  tests: [
    { id: "t1", title: "Sample test", minutes: 5, rubric: "You have five minutes. The test closes by itself when the time is over.", exercises: [
      { type: "exercise", id: "tq1", kind: "gap", title: "Complete the phrases", items: [
        { id: "1", text: "meet a ___", answer: "deadline" }, { id: "2", text: "take a ___", answer: "break" }, { id: "3", text: "put something ___", answer: "off" } ] },
    ] },
  ],
};

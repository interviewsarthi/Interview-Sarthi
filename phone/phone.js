/* Live Sarthi on your phone: page motion (hero scene, sample answers, reveal on scroll). */
(function () {
  "use strict";
  const reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const $ = (id) => document.getElementById(id);
  const html = (t) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>");
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  /* Type an answer word by word into el; resolves when done or when token changes. */
  async function type(el, text, token, speed = 55) {
    const words = text.split(" ");
    el.classList.add("typing");
    if (reduce) { el.innerHTML = html(text); el.classList.remove("typing"); return; }
    let out = "";
    for (let i = 0; i < words.length; i++) {
      if (token.dead) return;
      out += (i ? " " : "") + words[i];
      // keep **bold** balanced while it streams
      const open = (out.match(/\*\*/g) || []).length % 2 === 1;
      el.innerHTML = html(open ? out + "**" : out);
      await sleep(speed + (words[i].endsWith(".") ? 160 : 0));
    }
    el.classList.remove("typing");
  }

  // ── hero: the interviewer asks on the laptop, the phone answers ───────────────────────────────────────────────
  const HERO = [
    { q: "Tell me about a project you're proud of.",
      a: "So basically, at PayKart I cut checkout time from **900 ms to 300 ms**. Our order APIs were hitting MySQL on every request, so I added a **Redis caching layer** and kept prices fresh with event-based invalidation." },
    { q: "How do you handle a disagreement with your manager?",
      a: "I take it to them **one-on-one, with data**. Once my manager wanted to stop an A/B test early; I showed the sample size wasn't there yet, we ran it two more weeks, and the result **flipped**." },
    { q: "Why do you want to join us?",
      a: "Honestly, it's the **scale**. I've built payment APIs for thousands of users, and here I'd be working on millions, which is exactly the **next step** I'm looking for." },
  ];
  async function hero() {
    const stage = document.querySelector(".stage");
    const lq = $("laptop-q"), pq = $("phone-q"), pa = $("phone-a");
    if (!stage || !lq) return;
    if (reduce) { pa.innerHTML = html(HERO[0].a); return; }
    let i = 0;
    const token = {};
    for (;;) {
      const item = HERO[i % HERO.length];
      lq.textContent = item.q;
      pa.innerHTML = ""; pq.textContent = "Listening…";
      stage.classList.add("speaking");
      await sleep(2400);
      stage.classList.remove("speaking");
      pq.textContent = "Q: " + item.q;
      await sleep(350);
      await type(pa, item.a, token, 70);
      await sleep(4200);
      i++;
    }
  }

  // ── demo: tap a question, the phone answers ──────────────────────────────────────────────────────────────────
  const DEMO = [
    { q: "Tell me about yourself.",
      a: "So, I'm Asha, a **backend engineer with three years** at PayKart. I mostly build order and payment APIs in **Java and Spring Boot**. The thing I'm proudest of is cutting checkout latency from 900 to 300 milliseconds with Redis caching, which, umm, directly lifted our conversion. Before that I interned at Zoomcar writing Python reports for the fleet team. Now I'm looking for a role where I own a service end to end, at a bigger scale." },
    { q: "Why should we hire you?",
      a: "Because I've already done the **core of this job** in production. Your role needs someone who can keep APIs fast under load, and at PayKart I took checkout from **900 to 300 ms** during sale traffic. I also write the tests and the runbooks, so the service doesn't depend on me being online. And honestly, I'm at the point where I want **bigger scale**, which is exactly what you have." },
    { q: "Tell me about a time you missed a deadline.",
      a: "So, one sprint I promised a **refund API in four days** and it took six. The payment gateway's sandbox kept timing out and I kept trying to fix it alone. What I changed after that: I flag a risk on **day one, not day four**, and I build against a mock first. The next two integrations went out on time." },
    { q: "How would you find the second highest salary?",
      a: "I'd use **DENSE_RANK**, so ties don't break it, and pick rank two:", code: "SELECT salary\nFROM (\n  SELECT salary,\n         DENSE_RANK() OVER (ORDER BY salary DESC) AS rnk\n  FROM employees\n) t\nWHERE rnk = 2;" },
  ];
  let demoToken = { dead: true };
  async function showDemo(i) {
    demoToken.dead = true;
    const token = (demoToken = {});
    const item = DEMO[i];
    $("demo-q").textContent = "Q: " + item.q;
    const a = $("demo-a"), code = $("demo-code");
    a.innerHTML = ""; code.hidden = true; code.textContent = "";
    await sleep(reduce ? 0 : 500);
    if (token.dead) return;
    await type(a, item.a, token, 38);
    if (token.dead) return;
    if (item.code) { code.textContent = item.code; code.hidden = false; }
  }
  function demo() {
    const chips = document.querySelectorAll(".chip");
    chips.forEach((c) => c.addEventListener("click", () => {
      chips.forEach((x) => x.classList.toggle("on", x === c));
      showDemo(Number(c.dataset.i));
    }));
    const box = document.querySelector(".demo-phone");
    if (!box) return;
    if (!("IntersectionObserver" in window)) return showDemo(0);
    const io = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) { io.disconnect(); showDemo(0); } }, { threshold: 0.35 });
    io.observe(box);
  }

  // ── reveal on scroll ─────────────────────────────────────────────────────────────────────────────────────────
  function reveal() {
    const els = document.querySelectorAll(".reveal");
    if (reduce || !("IntersectionObserver" in window)) { els.forEach((e) => e.classList.add("in")); return; }
    const io = new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) { e.target.classList.add("in"); io.unobserve(e.target); } }), { threshold: 0.12, rootMargin: "0px 0px -40px 0px" });
    els.forEach((e, i) => { e.style.transitionDelay = (i % 3) * 80 + "ms"; io.observe(e); });
  }

  // ── buy links carry the region the visitor sees ──────────────────────────────────────────────────────────────
  function buyLinks() {
    const set = () => {
      const g = document.documentElement.dataset.region;
      document.querySelectorAll('a[href^="https://license.interviewsarthi.com/buy?plan="]').forEach((a) => {
        const plan = a.href.match(/plan=(\w+)/)[1];
        a.href = "https://license.interviewsarthi.com/buy?plan=" + plan + (g === "in" || g === "intl" ? "&region=" + g : "");
      });
    };
    new MutationObserver(set).observe(document.documentElement, { attributes: true, attributeFilter: ["data-region"] });
    set();
  }

  reveal(); hero(); demo(); buyLinks();
})();

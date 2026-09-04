/* Fam ETC landing page — the only script on the page. No dependencies.
   See docs/design/landing-2026/IMPLEMENTATION-GUIDE.md section 9. */
document.documentElement.classList.add('js');

// 1. Reveal the chat-action beats when the sequence scrolls into view. The
//    hidden state is gated on html.js (see landing.css), so if this file
//    never runs the beats simply stay visible.
var reveal = document.querySelectorAll('[data-reveal]');
if ('IntersectionObserver' in window) {
  var io = new IntersectionObserver(function (entries) {
    entries.forEach(function (e) {
      if (!e.isIntersecting) return;
      e.target.classList.add('is-in');
      io.unobserve(e.target);
    });
    // threshold 0 + a bottom margin: fires as soon as the sequence is
    // meaningfully on screen. A fractional threshold can never be met when the
    // element is taller than the viewport, which would leave it hidden.
  }, { threshold: 0, rootMargin: '0px 0px -80px 0px' });
  reveal.forEach(function (el) { io.observe(el); });
} else {
  reveal.forEach(function (el) { el.classList.add('is-in'); });
}

// Safety net: nothing on a marketing page should stay invisible because an
// observer did not fire. Reveal anything still hidden shortly after load.
window.setTimeout(function () {
  reveal.forEach(function (el) { el.classList.add('is-in'); });
}, 2000);

// 2. Kid mode / Parent mode tablist. Both panels live in the DOM; `hidden`
//    toggles. Arrow/Home/End keys move between tabs (WAI-ARIA tabs pattern).
var tabs = Array.prototype.slice.call(document.querySelectorAll('.mode-tab'));

function selectTab(tab, focus) {
  tabs.forEach(function (t) {
    var on = t === tab;
    t.setAttribute('aria-selected', String(on));
    t.tabIndex = on ? 0 : -1;
    var panel = document.getElementById(t.getAttribute('aria-controls'));
    if (panel) panel.hidden = !on;
  });
  var mode = tab.id.replace('tab-', '');
  document.querySelectorAll('.mode-text').forEach(function (p) {
    p.hidden = p.dataset.mode !== mode;
  });
  if (focus) tab.focus();
}

tabs.forEach(function (t, i) {
  t.addEventListener('click', function () { selectTab(t, false); });
  t.addEventListener('keydown', function (e) {
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      e.preventDefault();
      selectTab(tabs[(i + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length], true);
    } else if (e.key === 'Home') {
      e.preventDefault();
      selectTab(tabs[0], true);
    } else if (e.key === 'End') {
      e.preventDefault();
      selectTab(tabs[tabs.length - 1], true);
    }
  });
});

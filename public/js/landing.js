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

// 2. Stagger indices for [data-reveal="stagger"] groups. Done here rather than
//    with nth-child rules so a group can hold any number of children.
document.querySelectorAll('[data-reveal="stagger"]').forEach(function (group) {
  Array.prototype.forEach.call(group.children, function (child, i) {
    child.style.setProperty('--i', i);
  });
});

// 3. The sticky header takes a shadow once the page has scrolled under it.
//    An observer on a 1px sentinel, not a scroll listener: no work per frame.
var sentinel = document.getElementById('scroll-sentinel');
var header = document.querySelector('.site-header');
if (sentinel && header && 'IntersectionObserver' in window) {
  new IntersectionObserver(function (entries) {
    header.classList.toggle('is-scrolled', !entries[0].isIntersecting);
  }).observe(sentinel);
}

// Safety net: nothing on a marketing page should stay invisible because an
// observer did not fire. Reveal anything still hidden shortly after load.
window.setTimeout(function () {
  reveal.forEach(function (el) { el.classList.add('is-in'); });
}, 2000);

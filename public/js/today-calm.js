(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.famTodayCalm = factory();
  }
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function calmToday(options = {}) {
    const now = (options.now instanceof Date && !isNaN(options.now.getTime())) ? options.now : new Date();
    const hour = now.getHours();
    const needsYouCount = typeof options.needsYouCount === 'number' ? options.needsYouCount : 0;
    const tomorrowItems = Array.isArray(options.tomorrowItems) ? options.tomorrowItems : [];

    let greeting;
    if (hour < 12) {
      greeting = 'Good morning';
    } else if (hour < 17) {
      greeting = 'Good afternoon';
    } else {
      greeting = 'Good evening';
    }

    let calmLine = null;
    if (needsYouCount === 0) {
      if (hour < 17) {
        calmLine = 'Nothing needs you right now.';
      } else {
        calmLine = 'Nothing needs you. Enjoy dinner.';
      }
    }

    let tomorrowLine = null;
    if (hour >= 20 && tomorrowItems.length > 0) {
      const sorted = tomorrowItems.slice().sort((a, b) => {
        const tA = (a && a.time != null && String(a.time).trim() !== '') ? String(a.time).trim() : null;
        const tB = (b && b.time != null && String(b.time).trim() !== '') ? String(b.time).trim() : null;
        if (tA && tB) return tA.localeCompare(tB);
        if (tA && !tB) return -1;
        if (!tA && tB) return 1;
        return 0;
      });

      const titles = sorted
        .map(item => (typeof item === 'string' ? item.trim() : (item && item.title ? String(item.title).trim() : '')))
        .filter(Boolean);

      if (titles.length > 0) {
        tomorrowLine = 'Tomorrow: ' + titles.slice(0, 2).join(' · ');
      }
    }

    return { greeting, calmLine, tomorrowLine };
  }

  return { calmToday };
}));

/* ═══════════════════════════════════════════════════════════════════════
   Friday Website JavaScript
   Interactivity, Theme Switching, and Reveal Animations
   ═══════════════════════════════════════════════════════════════════════ */

// Note: style.css is loaded via <link> in HTML for standard browser compatibility

document.addEventListener('DOMContentLoaded', () => {
  console.log('[Friday] Website initializing...');
  document.body.classList.add('js-enabled');
  initTheme();
  initScrollHeader();
  initRevealAnimations();
  initCTAs();
  initNavbarToggle();
  initTabs();
  initAccordions();
});

/**
 * Handle Dark/Light Theme Switching
 */
function initTheme() {
  const themeBtn = document.getElementById('themeBtn');
  const themeIcon = document.getElementById('themeIcon') || themeBtn.querySelector('i');
  const root = document.documentElement;

  // Load saved theme
  const savedTheme = localStorage.getItem('friday-theme') || 'dark';
  root.setAttribute('data-theme', savedTheme);
  updateThemeIcon(savedTheme, themeIcon);

  themeBtn.addEventListener('click', () => {
    const currentTheme = root.getAttribute('data-theme') === 'light' ? 'dark' : 'light';
    root.setAttribute('data-theme', currentTheme);
    localStorage.setItem('friday-theme', currentTheme);
    updateThemeIcon(currentTheme, themeIcon);

    // Add a micro-animation to the button
    themeBtn.style.transform = 'scale(0.9) rotate(15deg)';
    setTimeout(() => {
      themeBtn.style.transform = 'scale(1) rotate(0)';
    }, 150);
  });
}

function updateThemeIcon(theme, icon) {
  if (!icon) return;
  // Ensure we use the correct classes for the HugeIcons CDN font (hgi prefix)
  if (theme === 'light') {
    icon.className = 'hgi hgi-stroke hgi-moon-01';
  } else {
    icon.className = 'hgi hgi-stroke hgi-sun-01';
  }
}

/**
 * Handle Header styling on scroll
 */
function initScrollHeader() {
  const header = document.getElementById('header');

  window.addEventListener('scroll', () => {
    if (window.scrollY > 50) {
      header.classList.add('scrolled');
    } else {
      header.classList.remove('scrolled');
    }
  });
}

/**
 * Progressive disclosure / Reveal on scroll
 */
function initRevealAnimations() {
  const observerOptions = {
    threshold: 0.05,
    rootMargin: '0px 0px -50px 0px'
  };

  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add('visible');
        observer.unobserve(entry.target);
      }
    });
  }, observerOptions);

  document.querySelectorAll('[data-reveal]').forEach(el => {
    observer.observe(el);
  });
}

/**
 * Navbar Toggle
 */
function initNavbarToggle() {
  const navToggle = document.getElementById('navbar-toggle');
  const navMenu = document.querySelector('.navbar__menu ul');

  if (navToggle && navMenu) {
    navToggle.addEventListener('click', () => {
      navMenu.classList.toggle('active');
    });
  }
}

/**
 * Tabs Logic
 */
function initTabs() {
  const tabHeaders = document.querySelectorAll('.usecases-tabs__heading h3');
  const tabContents = document.querySelectorAll('.usecases-tabs__domain-list');

  tabHeaders.forEach(header => {
    header.addEventListener('click', () => {
      const tabId = header.getAttribute('data-tab');

      tabHeaders.forEach(h => h.classList.remove('active'));
      tabContents.forEach(c => c.classList.remove('active'));
      tabContents.forEach(c => c.classList.add('d-none'));

      header.classList.add('active');
      const targetContent = document.getElementById(`tab-${tabId}`);
      if (targetContent) {
        targetContent.classList.add('active');
        targetContent.classList.remove('d-none');
      }
    });
  });
}

/**
 * Accordion Logic
 */
function initAccordions() {
  const accordions = document.querySelectorAll('.js-accordion');

  accordions.forEach(acc => {
    const header = acc.querySelector('.accordion__header');
    header.addEventListener('click', () => {
      acc.classList.toggle('active');
      const body = acc.querySelector('.accordion__body');
      if (acc.classList.contains('active')) {
        body.classList.remove('d-none');
      } else {
        body.classList.add('d-none');
      }
    });
  });
}

/**
 * Handle interactions for Download and CTAs
 */
function initCTAs() {
  const downloadBtns = document.querySelectorAll('.btn-primary, .btn-secondary');

  downloadBtns.forEach(btn => {
    btn.addEventListener('click', (e) => {
      const text = btn.textContent.toLowerCase();
      if (text.includes('download')) {
        console.log('[Friday] Triggering download sequence...');
        // Placeholder for actual download logic
        showDownloadFeedback(btn);
      }
    });
  });
}

function showDownloadFeedback(btn) {
  const originalText = btn.textContent;
  btn.textContent = 'Preparing Download...';
  btn.classList.add('clicked');

  setTimeout(() => {
    btn.textContent = originalText;
    btn.classList.remove('clicked');
  }, 2000);
}

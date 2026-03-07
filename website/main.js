/* ═══════════════════════════════════════════════════════════════════════
   Friday Website JavaScript
   Interactivity, Theme Switching, and Reveal Animations
   ═══════════════════════════════════════════════════════════════════════ */

import './style.css'

document.addEventListener('DOMContentLoaded', () => {
  initTheme();
  initScrollHeader();
  initRevealAnimations();
  initCTAs();
});

/**
 * Handle Dark/Light Theme Switching
 */
function initTheme() {
  const themeBtn = document.getElementById('themeBtn');
  const root = document.documentElement;

  // Load saved theme
  const savedTheme = localStorage.getItem('friday-theme') || 'dark';
  if (savedTheme === 'light') {
    root.classList.add('theme-light');
  }

  themeBtn.addEventListener('click', () => {
    root.classList.toggle('theme-light');
    const currentTheme = root.classList.contains('theme-light') ? 'light' : 'dark';
    localStorage.setItem('friday-theme', currentTheme);

    // Add a micro-animation to the button
    themeBtn.style.transform = 'scale(0.9) rotate(15deg)';
    setTimeout(() => {
      themeBtn.style.transform = 'scale(1) rotate(0)';
    }, 150);
  });
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
    threshold: 0.15,
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

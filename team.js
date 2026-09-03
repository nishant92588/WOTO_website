// ═══════════════════════════════════════════
//   TEAM PAGE — fetch teamInfo.json & animate
// ═══════════════════════════════════════════

(function () {
  const GRID_ID = 'teamGrid';
  const SKELETON_COUNT = 4;

  function getInitials(name) {
    if (!name) return '?';
    const parts = name.trim().split(/\s+/);
    const initials = parts.slice(0, 2).map(p => p[0]?.toUpperCase() || '').join('');
    return initials || '?';
  }

  function renderSkeletons(grid) {
    grid.innerHTML = '';
    for (let i = 0; i < SKELETON_COUNT; i++) {
      const el = document.createElement('div');
      el.className = 'team-skeleton';
      el.innerHTML = `
        <div class="team-skeleton-avatar"></div>
        <div class="team-skeleton-line w-60"></div>
        <div class="team-skeleton-line w-40"></div>
        <div class="team-skeleton-line w-90"></div>
      `;
      grid.appendChild(el);
    }
  }

  function socialIcon(type) {
    if (type === 'linkedin') return 'in';
    if (type === 'twitter') return '𝕏';
    return '↗';
  }

  function renderCard(member) {
    const card = document.createElement('div');
    card.className = 'team-card';

    const avatarInner = member.photo
      ? `<img src="${member.photo}" alt="${member.name}">`
      : getInitials(member.name);

    const socials = [];
    if (member.linkedin) socials.push(`<a href="${member.linkedin}" target="_blank" rel="noopener">${socialIcon('linkedin')}</a>`);
    if (member.twitter) socials.push(`<a href="${member.twitter}" target="_blank" rel="noopener">${socialIcon('twitter')}</a>`);

    card.innerHTML = `
      <div class="team-avatar">${avatarInner}</div>
      <div class="team-card-name">${member.name || 'Team Member'}</div>
      <div class="team-card-role">${member.role || ''}</div>
      ${member.bio ? `<p class="team-card-bio">${member.bio}</p>` : ''}
      ${socials.length ? `<div class="team-card-social">${socials.join('')}</div>` : ''}
    `;

    // Subtle tilt-on-hover, only when GSAP is available
    if (window.gsap) {
      card.addEventListener('mousemove', (e) => {
        const rect = card.getBoundingClientRect();
        const x = e.clientX - rect.left - rect.width / 2;
        const y = e.clientY - rect.top - rect.height / 2;
        gsap.to(card, {
          rotateX: (-y / rect.height) * 8,
          rotateY: (x / rect.width) * 8,
          transformPerspective: 600,
          duration: 0.4,
          ease: 'power2.out'
        });
      });
      card.addEventListener('mouseleave', () => {
        gsap.to(card, { rotateX: 0, rotateY: 0, duration: 0.5, ease: 'power2.out' });
      });
    }

    return card;
  }

  async function loadTeam() {
    const grid = document.getElementById(GRID_ID);
    if (!grid) return;

    renderSkeletons(grid);

    try {
      const res = await fetch('teamInfo.json', { cache: 'no-store' });
      if (!res.ok) throw new Error('Failed to load team data');
      const members = await res.json();

      grid.innerHTML = '';

      if (!Array.isArray(members) || members.length === 0) {
        grid.innerHTML = '<div class="team-empty">Team info coming soon.</div>';
        return;
      }

      members.forEach(member => grid.appendChild(renderCard(member)));

      // Entrance animation
      if (window.gsap) {
        gsap.to('.team-card', {
          opacity: 1,
          y: 0,
          duration: 0.7,
          ease: 'power3.out',
          stagger: 0.1
        });
      } else {
        document.querySelectorAll('.team-card').forEach(c => {
          c.style.opacity = 1;
          c.style.transform = 'translateY(0)';
        });
      }
    } catch (err) {
      console.error(err);
      grid.innerHTML = '<div class="team-empty">Couldn\'t load the team right now. Please try again shortly.</div>';
    }
  }

  function animateHero() {
    if (!window.gsap) return;
    gsap.from('.team-hero-badge, .team-hero-title, .team-hero-desc', {
      opacity: 0,
      y: 24,
      duration: 0.8,
      ease: 'power3.out',
      stagger: 0.12
    });
  }

  document.addEventListener('DOMContentLoaded', () => {
    animateHero();
    loadTeam();
  });
})();

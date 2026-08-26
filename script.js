// Mobile menu
  const hamburger = document.getElementById('hamburger');
  const mobileMenu = document.getElementById('mobileMenu');

  hamburger.addEventListener('click', () => {
    mobileMenu.classList.toggle('open');
  });

  function closeMobile() {
    mobileMenu.classList.remove('open');
  }

  // Scroll reveal
  const reveals = document.querySelectorAll('.reveal');
  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add('visible');
      }
    });
  }, { threshold: 0.12, rootMargin: '0px 0px -30px 0px' });

  reveals.forEach(el => observer.observe(el));

  // Toast
  function showToast(msg, icon = '✅') {
    const toast = document.getElementById('toast');
    document.getElementById('toastMsg').textContent = msg;
    document.getElementById('toastIcon').textContent = icon;
    toast.style.transform = 'translateY(0)';
    toast.style.opacity = '1';
    setTimeout(() => {
      toast.style.transform = 'translateY(100px)';
      toast.style.opacity = '0';
    }, 3500);
  }

  // Form handlers
  async function handleFormSubmit(e) {
    e.preventDefault();
    const form = e.target;
    const submitBtn = form.querySelector('button[type="submit"]');
    const originalBtnText = submitBtn.textContent;

    submitBtn.disabled = true;
    submitBtn.textContent = 'Submitting...';

    const formData = new FormData(form);

    try {
      const response = await fetch('/api/apply', {
        method: 'POST',
        body: formData
      });
      const data = await response.json();

      if (response.ok && data.success) {
        showToast('Application submitted! We\'ll be in touch soon.', '🚀');
        form.reset();
        document.getElementById('fileLabel').textContent = 'Upload your resume (PDF or DOC, max 5MB)';
      } else {
        showToast(data.error || 'An error occurred during submission.', '⚠️');
      }
    } catch (error) {
      console.error(error);
      showToast('Network error. Failed to connect to server.', '⚠️');
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = originalBtnText;
    }
  }

  async function handleContactSubmit(e) {
    e.preventDefault();
    const form = e.target;
    const submitBtn = form.querySelector('button[type="submit"]');
    const originalBtnText = submitBtn.textContent;

    submitBtn.disabled = true;
    submitBtn.textContent = 'Sending...';

    const formData = new FormData(form);
    const payload = {
      name: formData.get('name'),
      email: formData.get('email'),
      subject: formData.get('subject'),
      message: formData.get('message')
    };

    try {
      const response = await fetch('/api/contact', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      });
      const data = await response.json();

      if (response.ok && data.success) {
        showToast('Message sent! We\'ll reply within 24 hours.', '✉️');
        form.reset();
      } else {
        showToast(data.error || 'An error occurred.', '⚠️');
      }
    } catch (error) {
      console.error(error);
      showToast('Network error. Failed to send message.', '⚠️');
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = originalBtnText;
    }
  }

  function updateFileLabel(input) {
    const label = document.getElementById('fileLabel');
    if (input.files && input.files[0]) {
      label.textContent = input.files[0].name;
    }
  }

  // Navbar scroll effect
  window.addEventListener('scroll', () => {
    const nav = document.getElementById('navbar');
    if (window.scrollY > 40) {
      nav.style.background = 'rgba(25,24,36,0.97)';
    } else {
      nav.style.background = 'rgba(41,38,77,0.92)';
    }
  });

  // Smooth section reveal on load
  window.addEventListener('load', () => {
    document.querySelectorAll('.hero .reveal').forEach((el, i) => {
      setTimeout(() => el.classList.add('visible'), i * 120);
    });
  });

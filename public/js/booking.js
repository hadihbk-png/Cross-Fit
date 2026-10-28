// Booking form: show the coach for the chosen class and load sessions for the chosen date
(() => {
  const form = document.getElementById('booking-form');
  if (!form) return;

  const sessionsBox = document.getElementById('sessions');
  const placeholder = document.querySelector('.coach-placeholder');
  const coachCards = document.querySelectorAll('.coach-pick');
  let latestRequest = 0;

  const selectedClass = () => form.querySelector('input[name="classType"]:checked')?.value || '';

  function showCoach() {
    const key = selectedClass();
    placeholder.hidden = Boolean(key);
    coachCards.forEach((card) => { card.hidden = card.dataset.class !== key; });
  }

  async function loadSessions() {
    const date = form.elements.date.value;
    if (!date) return;
    const previous = form.querySelector('input[name="time"]:checked')?.value;
    const requestId = ++latestRequest;

    sessionsBox.setAttribute('aria-busy', 'true');
    try {
      const params = new URLSearchParams({ class: selectedClass(), date });
      const res = await fetch(`/booking/sessions?${params}`);
      if (!res.ok) throw new Error(res.statusText);
      const html = await res.text();
      if (requestId !== latestRequest) return; // a newer request has replaced this one

      sessionsBox.innerHTML = html; // rendered and escaped by the server
      if (previous) {
        const again = sessionsBox.querySelector(`input[value="${CSS.escape(previous)}"]`);
        if (again && !again.disabled) again.checked = true;
      }
    } catch {
      if (requestId === latestRequest) {
        sessionsBox.innerHTML = '<p class="text-danger mb-0">Couldn’t load sessions. Please try again.</p>';
      }
    } finally {
      if (requestId === latestRequest) sessionsBox.removeAttribute('aria-busy');
    }
  }

  form.addEventListener('change', (e) => {
    if (e.target.name === 'classType') {
      showCoach();
      loadSessions();
    } else if (e.target.name === 'date') {
      loadSessions();
    }
  });
})();

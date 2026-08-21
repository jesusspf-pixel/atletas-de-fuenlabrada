(() => {
  const FRIENDLY = [
    [/email rate limit exceeded/i, "No hemos podido enviarte el correo de confirmación. Si ya creaste tu cuenta, solicita uno nuevo con el botón de abajo."],
    [/error sending confirmation email/i, "No hemos podido enviarte el correo de confirmación. Si la cuenta ya se creó, puedes solicitar un nuevo correo ahora."],
    [/user already registered|already been registered|already registered/i, "Este correo ya tiene una cuenta. Entra con tu contraseña o solicita un nuevo correo de confirmación si todavía no la activaste."],
    [/email not confirmed|email_not_confirmed/i, "Tu cuenta existe, pero falta confirmar el correo electrónico. Solicita un nuevo correo de confirmación."],
    [/invalid login credentials/i, "El correo o la contraseña no son correctos. Si acabas de registrarte y no confirmaste el correo, solicita uno nuevo."],
  ];

  function emailInput() {
    return document.querySelector('.access-box input[type="email"]');
  }

  function normalizeErrors() {
    document.querySelectorAll('.access-box .error-note').forEach((node) => {
      const text = (node.textContent || '').trim();
      for (const [pattern, replacement] of FRIENDLY) {
        if (pattern.test(text)) {
          node.textContent = replacement;
          node.dataset.friendlyAuth = 'true';
          break;
        }
      }
    });
  }

  function ensureRecoveryButton() {
    const box = document.querySelector('.access-box');
    const input = emailInput();
    if (!box || !input || box.querySelector('[data-resend-confirmation]')) return;

    const toggleButtons = [...box.querySelectorAll('button.plain')];
    const toggle = toggleButtons.find((button) => /cuenta|entrar|inscripci/i.test(button.textContent || ''));
    if (!toggle) return;

    const wrap = document.createElement('div');
    wrap.dataset.resendConfirmation = 'true';
    wrap.style.marginTop = '10px';

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'plain';
    button.textContent = '¿No recibiste el correo? Reenviar confirmación';

    const status = document.createElement('p');
    status.style.margin = '8px 0 0';
    status.style.fontSize = '0.95rem';
    status.style.lineHeight = '1.4';

    button.addEventListener('click', async () => {
      const email = String(emailInput()?.value || '').trim();
      if (!email || !email.includes('@')) {
        status.textContent = 'Escribe primero el correo con el que creaste la cuenta.';
        status.style.color = '#b42318';
        return;
      }
      button.disabled = true;
      button.textContent = 'Enviando…';
      status.textContent = '';
      try {
        const response = await fetch('/api/resend-confirmation', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ email }),
        });
        const data = await response.json().catch(() => ({}));
        status.textContent = data.message || data.error || (response.ok ? 'Correo enviado.' : 'No se pudo reenviar el correo.');
        status.style.color = response.ok ? '#166534' : '#b42318';
      } catch {
        status.textContent = 'No se pudo contactar con el servicio de correo. Inténtalo de nuevo en unos minutos.';
        status.style.color = '#b42318';
      } finally {
        button.disabled = false;
        button.textContent = '¿No recibiste el correo? Reenviar confirmación';
      }
    });

    wrap.append(button, status);
    toggle.parentNode?.insertBefore(wrap, toggle);
  }

  function refresh() {
    normalizeErrors();
    ensureRecoveryButton();
  }

  let queued = false;
  const observer = new MutationObserver(() => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      refresh();
    });
  });
  observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true });
  document.addEventListener('DOMContentLoaded', refresh);
  refresh();
})();

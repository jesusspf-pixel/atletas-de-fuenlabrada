(() => {
  const FRIENDLY = [
    [/email rate limit exceeded/i, ["Se ha alcanzado temporalmente el límite de correos. Espera un minuto y vuelve a intentarlo.", true]],
    [/error sending confirmation email/i, ["No se ha creado la cuenta porque falló el servidor de correo. Pulsa Crear cuenta para intentarlo de nuevo.", false]],
    [/user already registered|already been registered|already registered/i, ["Este correo ya tiene una cuenta. Entra con tu contraseña.", false]],
    [/email not confirmed|email_not_confirmed/i, ["Tu cuenta existe, pero falta confirmar el correo electrónico.", true]],
    [/invalid login credentials/i, ["El correo o la contraseña no son correctos.", false]],
  ];

  function emailInput() {
    return document.querySelector('.access-box input[type="email"]');
  }

  function normalizeErrors() {
    document.querySelectorAll('.access-box .error-note').forEach((node) => {
      const text = (node.textContent || '').trim();
      for (const [pattern, value] of FRIENDLY) {
        if (!pattern.test(text)) continue;
        node.textContent = value[0];
        node.dataset.needsConfirmation = value[1] ? 'true' : 'false';
        break;
      }
    });
  }

  function setStatus(node, message, ok) {
    node.textContent = message;
    node.style.margin = '8px 0 0';
    node.style.fontSize = '0.95rem';
    node.style.lineHeight = '1.4';
    node.style.color = ok ? '#166534' : '#b42318';
  }

  async function resendConfirmation(status, button) {
    const email = String(emailInput()?.value || '').trim();
    if (!email || !email.includes('@')) {
      setStatus(status, 'Escribe primero el correo con el que creaste la cuenta.', false);
      emailInput()?.focus();
      return;
    }
    button.disabled = true;
    const original = button.textContent;
    button.textContent = 'Enviando…';
    try {
      const response = await fetch('/api/resend-confirmation', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      const data = await response.json().catch(() => ({}));
      setStatus(status, data.message || data.error || 'No se pudo reenviar el correo.', response.ok);
    } catch {
      setStatus(status, 'No se pudo contactar con el servicio de correo. Inténtalo de nuevo en unos minutos.', false);
    } finally {
      button.disabled = false;
      button.textContent = original;
    }
  }

  function ensureActions() {
    const box = document.querySelector('.access-box');
    const input = emailInput();
    if (!box || !input) return;

    const title = box.querySelector('h1');
    if (!title) return;
    const isLogin = /entra en tu cuenta/i.test(title.textContent || '');
    const isSignup = /crea tu cuenta/i.test(title.textContent || '');
    if (!isLogin && !isSignup) {
      box.querySelectorAll('[data-auth-help]').forEach((node) => node.remove());
      return;
    }

    const toggle = [...box.querySelectorAll('button.plain')].find((button) =>
      /aún no tienes cuenta|inicia tu inscripción|ya tienes una cuenta|entrar/i.test(button.textContent || '')
    );
    if (!toggle) return;

    const message = (box.querySelector('.error-note')?.textContent || '').trim();
    const signupSent = isSignup && /revisa tu correo|confirma la cuenta/i.test(message);
    const needsConfirmation = Boolean(box.querySelector('.error-note[data-needs-confirmation="true"]'));
    const showResend = isLogin || signupSent || needsConfirmation;

    let wrap = box.querySelector('[data-auth-help]');
    const mode = `${isLogin ? 'login' : 'signup'}-${showResend}`;
    if (wrap && wrap.dataset.mode === mode) return;
    if (wrap) wrap.remove();

    wrap = document.createElement('div');
    wrap.dataset.authHelp = 'true';
    wrap.dataset.mode = mode;
    wrap.style.marginTop = '10px';

    const status = document.createElement('p');

    if (isLogin) {
      const forgot = document.createElement('button');
      forgot.type = 'button';
      forgot.className = 'plain';
      forgot.textContent = '¿Olvidaste tu contraseña?';
      forgot.addEventListener('click', async () => {
        const email = String(emailInput()?.value || '').trim();
        if (!email || !email.includes('@')) {
          setStatus(status, 'Escribe primero tu correo electrónico.', false);
          emailInput()?.focus();
          return;
        }
        forgot.disabled = true;
        forgot.textContent = 'Enviando…';
        try {
          const response = await fetch('/api/request-password-reset', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ email }),
          });
          const data = await response.json().catch(() => ({}));
          setStatus(status, data.message || data.error || 'No se pudo enviar el correo de recuperación.', response.ok);
        } catch {
          setStatus(status, 'No se pudo contactar con el servicio de recuperación. Inténtalo de nuevo en unos minutos.', false);
        } finally {
          forgot.disabled = false;
          forgot.textContent = '¿Olvidaste tu contraseña?';
        }
      });
      wrap.appendChild(forgot);
    }

    if (showResend) {
      const resend = document.createElement('button');
      resend.type = 'button';
      resend.className = 'plain';
      resend.style.display = 'block';
      resend.textContent = isSignup ? '¿No te llegó el correo? Reenviar confirmación' : '¿No recibiste la confirmación? Reenviar correo';
      resend.addEventListener('click', () => void resendConfirmation(status, resend));
      wrap.appendChild(resend);
    }

    wrap.appendChild(status);
    toggle.parentNode?.insertBefore(wrap, toggle);
  }

  function refresh() {
    normalizeErrors();
    ensureActions();
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

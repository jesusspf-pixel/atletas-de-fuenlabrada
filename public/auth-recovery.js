(() => {
  const FRIENDLY = [
    [/email rate limit exceeded/i, ["Se ha alcanzado temporalmente el límite de correos. Espera un minuto y vuelve a intentarlo.", true]],
    [/error sending confirmation email/i, ["No hemos podido enviarte el correo de confirmación. Puedes solicitar uno nuevo.", true]],
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

  function ensureBillingStatus() {
    const headers = [...document.querySelectorAll('.club-content h1')];
    const title = headers.find((node) => /cuotas y cobros/i.test(node.textContent || ''));
    if (!title) return;

    const content = title.closest('.club-content') || document.querySelector('.club-content');
    if (!content || content.querySelector('[data-stripe-test-status="true"]')) return;

    const twoColumns = content.querySelector('.two-columns');
    if (!twoColumns) return;

    const card = document.createElement('article');
    card.className = 'panel';
    card.dataset.stripeTestStatus = 'true';
    card.style.border = '1px solid rgba(37, 99, 235, .22)';
    card.style.background = 'linear-gradient(180deg, rgba(37,99,235,.07), rgba(255,255,255,.98))';

    const label = document.createElement('small');
    label.textContent = 'STRIPE · ENTORNO DE PRUEBA';
    label.style.fontWeight = '800';
    label.style.letterSpacing = '.08em';

    const heading = document.createElement('h2');
    heading.textContent = 'Stripe preparado';

    const text = document.createElement('p');
    text.textContent = 'La cuenta de prueba y el webhook ya están configurados. El cobro sigue desactivado temporalmente mientras validamos el flujo sin afectar al resto de la app.';

    const prices = document.createElement('p');
    prices.innerHTML = '<b>Cuota mensual:</b> 35 € · <b>Cuota trimestral:</b> 70 €';

    const security = document.createElement('p');
    security.textContent = 'La tarjeta y el CVV se gestionarán únicamente en Stripe; la aplicación no almacenará esos datos.';

    card.append(label, heading, text, prices, security);
    twoColumns.prepend(card);
  }

  function refresh() {
    normalizeErrors();
    ensureActions();
    ensureBillingStatus();
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

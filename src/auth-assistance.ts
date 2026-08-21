import { supabase } from "./lib/supabase";

const CANONICAL_ORIGIN = "https://atletasdefuenlabrada.com";

const FRIENDLY: Array<[RegExp, string, boolean]> = [
  [/email rate limit exceeded/i, "No hemos podido enviarte el correo. Espera un minuto y vuelve a intentarlo.", true],
  [/error sending confirmation email/i, "No hemos podido enviarte el correo de confirmación. Puedes solicitar uno nuevo.", true],
  [/user already registered|already been registered|already registered/i, "Este correo ya tiene una cuenta. Entra con tu contraseña.", false],
  [/email not confirmed|email_not_confirmed/i, "Tu cuenta existe, pero falta confirmar el correo electrónico.", true],
  [/invalid login credentials/i, "El correo o la contraseña no son correctos.", false],
];

function emailInput() {
  return document.querySelector<HTMLInputElement>('.access-box input[type="email"]');
}

function normalizeErrors() {
  document.querySelectorAll<HTMLElement>('.access-box .error-note').forEach((node) => {
    if (node.dataset.authNormalized === "true") return;
    const text = (node.textContent || "").trim();
    for (const [pattern, replacement, needsConfirmation] of FRIENDLY) {
      if (!pattern.test(text)) continue;
      node.textContent = replacement;
      node.dataset.authNormalized = "true";
      if (needsConfirmation) node.dataset.needsConfirmation = "true";
      break;
    }
  });
}

function setStatus(node: HTMLElement, message: string, ok = false) {
  node.textContent = message;
  node.style.margin = "8px 0 0";
  node.style.fontSize = "0.95rem";
  node.style.lineHeight = "1.4";
  node.style.color = ok ? "#166534" : "#b42318";
}

async function resendConfirmation(button: HTMLButtonElement, status: HTMLElement) {
  const email = String(emailInput()?.value || "").trim();
  if (!email || !email.includes("@")) {
    setStatus(status, "Escribe primero el correo con el que creaste la cuenta.");
    return;
  }
  button.disabled = true;
  button.textContent = "Enviando…";
  status.textContent = "";
  try {
    const response = await fetch("/api/resend-confirmation", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email }),
    });
    const data = await response.json().catch(() => ({})) as { message?: string; error?: string };
    setStatus(status, data.message || data.error || (response.ok ? "Correo enviado." : "No se pudo reenviar el correo."), response.ok);
  } catch {
    setStatus(status, "No se pudo contactar con el servicio de correo. Inténtalo de nuevo en unos minutos.");
  } finally {
    button.disabled = false;
    button.textContent = "Reenviar correo de confirmación";
  }
}

async function requestPasswordReset(button: HTMLButtonElement, status: HTMLElement) {
  const client = supabase;
  const email = String(emailInput()?.value || "").trim();
  if (!client) return setStatus(status, "El servicio de acceso no está disponible ahora mismo.");
  if (!email || !email.includes("@")) {
    setStatus(status, "Escribe primero tu correo electrónico.");
    emailInput()?.focus();
    return;
  }
  button.disabled = true;
  button.textContent = "Enviando…";
  status.textContent = "";
  const { error } = await client.auth.resetPasswordForEmail(email, {
    redirectTo: `${CANONICAL_ORIGIN}/?reset-password=1`,
  });
  button.disabled = false;
  button.textContent = "¿Olvidaste tu contraseña?";
  if (error) {
    if (/rate limit|too many|seconds/i.test(error.message)) return setStatus(status, "Espera al menos un minuto antes de solicitar otro correo.");
    return setStatus(status, "No hemos podido enviar el correo de recuperación. Inténtalo de nuevo en unos minutos.");
  }
  setStatus(status, "Si existe una cuenta con ese correo, recibirás un enlace para crear una contraseña nueva. Revisa también Spam.", true);
}

function ensureAuthActions() {
  const box = document.querySelector<HTMLElement>(".access-box");
  const input = emailInput();
  if (!box || !input) return;

  // Elimina la versión antigua que mostraba siempre el reenvío de confirmación.
  box.querySelectorAll<HTMLElement>("[data-resend-confirmation]").forEach((node) => node.remove());

  const title = box.querySelector("h1")?.textContent || "";
  const loginMode = /entra en tu cuenta/i.test(title);
  const existing = box.querySelector<HTMLElement>("[data-auth-assistance]");
  if (!loginMode) {
    existing?.remove();
    return;
  }

  const toggle = [...box.querySelectorAll<HTMLButtonElement>("button.plain")]
    .find((button) => /aún no tienes cuenta|inicia tu inscripción/i.test(button.textContent || ""));
  if (!toggle) return;

  const needsConfirmation = Boolean(box.querySelector('.error-note[data-needs-confirmation="true"]'));
  if (existing && existing.dataset.confirmation === String(needsConfirmation)) return;
  existing?.remove();

  const wrap = document.createElement("div");
  wrap.dataset.authAssistance = "true";
  wrap.dataset.confirmation = String(needsConfirmation);
  wrap.style.marginTop = "10px";

  const status = document.createElement("p");

  const forgot = document.createElement("button");
  forgot.type = "button";
  forgot.className = "plain";
  forgot.textContent = "¿Olvidaste tu contraseña?";
  forgot.addEventListener("click", () => void requestPasswordReset(forgot, status));
  wrap.appendChild(forgot);

  if (needsConfirmation) {
    const resend = document.createElement("button");
    resend.type = "button";
    resend.className = "plain";
    resend.textContent = "Reenviar correo de confirmación";
    resend.style.display = "block";
    resend.addEventListener("click", () => void resendConfirmation(resend, status));
    wrap.appendChild(resend);
  }

  wrap.appendChild(status);
  toggle.parentNode?.insertBefore(wrap, toggle);
}

let resetOverlay: HTMLElement | null = null;

function showPasswordReset() {
  if (resetOverlay || !supabase) return;
  const overlay = document.createElement("main");
  overlay.className = "secure-screen";
  overlay.dataset.passwordReset = "true";
  overlay.style.position = "fixed";
  overlay.style.inset = "0";
  overlay.style.zIndex = "99999";
  overlay.innerHTML = `
    <section class="access-box">
      <small>ACCESO SEGURO</small>
      <h1>Crea una contraseña nueva</h1>
      <p>Introduce tu nueva contraseña para volver a acceder a la aplicación.</p>
      <form data-reset-form>
        <label>Nueva contraseña<input required minlength="8" type="password" autocomplete="new-password" data-password-one /></label>
        <label>Repite la contraseña<input required minlength="8" type="password" autocomplete="new-password" data-password-two /></label>
        <button type="submit">Guardar nueva contraseña</button>
      </form>
      <p data-reset-status></p>
    </section>`;
  document.body.appendChild(overlay);
  resetOverlay = overlay;

  const form = overlay.querySelector<HTMLFormElement>("[data-reset-form]")!;
  const status = overlay.querySelector<HTMLElement>("[data-reset-status]")!;
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const first = overlay.querySelector<HTMLInputElement>("[data-password-one]")!.value;
    const second = overlay.querySelector<HTMLInputElement>("[data-password-two]")!.value;
    if (first.length < 8) return setStatus(status, "La contraseña debe tener al menos 8 caracteres.");
    if (first !== second) return setStatus(status, "Las dos contraseñas no coinciden.");
    const button = form.querySelector<HTMLButtonElement>('button[type="submit"]')!;
    button.disabled = true;
    button.textContent = "Guardando…";
    const { error } = await supabase!.auth.updateUser({ password: first });
    if (error) {
      button.disabled = false;
      button.textContent = "Guardar nueva contraseña";
      return setStatus(status, "El enlace ha caducado o no es válido. Solicita un nuevo correo de recuperación.");
    }
    setStatus(status, "Contraseña actualizada. Ya puedes entrar con la nueva contraseña.", true);
    await supabase!.auth.signOut();
    window.setTimeout(() => window.location.assign(CANONICAL_ORIGIN), 900);
  });
}

function checkRecoveryRoute() {
  const params = new URLSearchParams(window.location.search);
  const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  if (params.get("reset-password") === "1" || hash.get("type") === "recovery") showPasswordReset();
}

function refresh() {
  normalizeErrors();
  ensureAuthActions();
  checkRecoveryRoute();
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

if (supabase) {
  supabase.auth.onAuthStateChange((event) => {
    if (event === "PASSWORD_RECOVERY") showPasswordReset();
  });
}

document.addEventListener("DOMContentLoaded", refresh);
refresh();

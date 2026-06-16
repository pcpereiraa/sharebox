/* ─────────────────────────────────────────────────────
   ShareBox — auth.js
───────────────────────────────────────────────────── */

async function requireAuth() {
  const { data: { session } } = await supabaseClient.auth.getSession();
  if (!session) { window.location.href = 'login.html'; return null; }
  return session;
}

async function requireGuest() {
  const { data: { session } } = await supabaseClient.auth.getSession();
  if (!session) return;
  const isAdmin = await checkIsAdmin(session.user.id);
  window.location.href = isAdmin ? 'admin/index.html' : 'home.html';
}

async function checkIsAdmin(userId) {
  const { data, error } = await supabaseClient
    .from('profiles')
    .select('is_admin')
    .eq('id', userId)
    .single();
  console.log('[Auth] checkIsAdmin →', data, error);
  return data?.is_admin === true;
}

async function getCurrentProfile() {
  const { data: { session } } = await supabaseClient.auth.getSession();
  if (!session) return null;
  const { data } = await supabaseClient
    .from('profiles').select('*').eq('id', session.user.id).single();
  return data;
}

async function logout() {
  await supabaseClient.auth.signOut();
  window.location.href = 'login.html';
}

function showError(elementId, message) {
  const el = document.getElementById(elementId);
  if (!el) return;
  el.textContent = message;
  el.style.cssText = 'display:block;color:#c0392b;background:rgba(192,57,43,0.08);padding:10px 14px;border-radius:8px;margin-top:8px;font-family:sans-serif;font-size:14px;';
}

function showSuccess(elementId, message) {
  const el = document.getElementById(elementId);
  if (!el) return;
  el.textContent = message;
  el.style.cssText = 'display:block;color:#016e58;background:rgba(1,110,88,0.08);padding:10px 14px;border-radius:8px;margin-top:8px;font-family:sans-serif;font-size:14px;';
}

function setLoading(buttonId, loading, originalText) {
  const btn = document.getElementById(buttonId);
  if (!btn) return;
  btn.disabled = loading;
  btn.textContent = loading ? 'A processar...' : originalText;
}

function translateError(msg) {
  if (msg.includes('Invalid login credentials')) return 'Email ou password incorretos.';
  if (msg.includes('Email not confirmed'))       return 'Confirma o teu email antes de entrar.';
  if (msg.includes('User already registered'))   return 'Este email já está registado.';
  if (msg.includes('Password should be'))        return 'A password deve ter pelo menos 6 caracteres.';
  if (msg.includes('rate limit'))                return 'Demasiadas tentativas. Tenta mais tarde.';
  return msg;
}

document.addEventListener('DOMContentLoaded', function () {

  // ── REGISTO ──────────────────────────────────────────
  const registerForm = document.getElementById('register-form');
  if (registerForm) {
    requireGuest();
    registerForm.addEventListener('submit', async function (e) {
      e.preventDefault();
      const name    = (document.getElementById('input-name')?.value || '').trim();
      const surname = (document.getElementById('input-surname')?.value || '').trim();
      const email   = (document.getElementById('input-email')?.value || '').trim();
      const pwd     = (document.getElementById('input-pwd')?.value || '');
      const pwd2    = (document.getElementById('input-pwd2')?.value || '');
      if (!name || !surname || !email || !pwd) { showError('register-error', 'Preenche todos os campos.'); return; }
      if (pwd !== pwd2) { showError('register-error', 'As passwords não coincidem.'); return; }
      if (pwd.length < 6) { showError('register-error', 'Password com mínimo 6 caracteres.'); return; }
      setLoading('register-submit', true, 'Criar conta');
      const { error } = await supabaseClient.auth.signUp({
        email, password: pwd,
        options: { data: { full_name: name + ' ' + surname } }
      });
      setLoading('register-submit', false, 'Criar conta');
      if (error) { showError('register-error', translateError(error.message)); return; }
      showSuccess('register-error', 'Conta criada! Verifica o teu email.');
      setTimeout(() => window.location.href = 'login.html', 2500);
    });
  }

  // ── LOGIN ────────────────────────────────────────────
  const loginForm = document.getElementById('login-form');
  if (loginForm) {
    requireGuest();
    loginForm.addEventListener('submit', async function (e) {
      e.preventDefault();
      const email = (document.getElementById('login-email')?.value || '').trim();
      const pwd   = (document.getElementById('login-pwd')?.value || '');
      if (!email || !pwd) { showError('login-error', 'Preenche o email e a password.'); return; }
      setLoading('login-submit', true, 'Entrar');
      const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password: pwd });
      setLoading('login-submit', false, 'Entrar');
      if (error) { showError('login-error', translateError(error.message)); return; }

      const userId = data.user.id;
      const { data: profile, error: profileError } = await supabaseClient
        .from('profiles').select('is_admin').eq('id', userId).single();

      const isAdmin = profile?.is_admin === true;

      window.location.href =
          isAdmin
              ? 'admin/index.html'
              : 'home.html';
    });
  }

  // ── LOGOUT ───────────────────────────────────────────
  const logoutBtn = document.getElementById('logout-btn');
  if (logoutBtn) {
    logoutBtn.addEventListener('click', async function (e) {
      e.preventDefault();
      await logout();
    });
  }

});
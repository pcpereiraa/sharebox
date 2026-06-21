/* ─────────────────────────────────────────────────────────────────
   Centraliza tudo o que é autenticação:
     - registo de conta (signUp)
     - login (signInWithPassword)
     - logout (signOut)
     - proteção de páginas (requireAuth / requireGuest)
     - verificação de admin (checkIsAdmin)
     - pequenos helpers de UI (mensagens de erro/sucesso, loading,
       tradução de mensagens de erro do Supabase para português)

   Este ficheiro é incluído em quase todas as páginas porque o
   listener no fundo (DOMContentLoaded) só ativa o código relevante
   se encontrar no DOM o formulário correspondente (#register-form,
   #login-form, #logout-btn). Ou seja: o MESMO ficheiro serve para
   login.html, register.html e qualquer página que tenha um botão
   de logout — não há duplicação de lógica de autenticação.
───────────────────────────────────────────────────────────────────── */

/**
 * requireAuth
 * -----------
 * "Guarda de rota" para páginas que só podem ser vistas por
 * utilizadores autenticados (ex: home.html, my_items.html, chat.html).
 *
 * Vai buscar a sessão atual ao Supabase Auth. Se não existir sessão
 * (utilizador não está logado, ou o token expirou), redireciona
 * imediatamente para login.html e devolve null — qualquer código
 * a seguir a esta chamada na página chamadora não deve continuar
 * a executar (por isso normalmente se faz `if (!session) return;`).
 *
 * @returns {Promise<Object|null>} a sessão do Supabase Auth, ou null
 *          se o utilizador não estiver autenticado (e nesse caso já
 *          foi feito o redirect para login.html).
 */
async function requireAuth() {
  const { data: { session } } = await supabaseClient.auth.getSession();
  if (!session) { window.location.href = 'login.html'; return null; }
  return session;
}

/**
 * requireGuest
 * ------------
 * O inverso de requireAuth: usado nas páginas de login/registo para
 * impedir que um utilizador JÁ autenticado volte a ver o formulário
 * de login (não faz sentido pedir para entrar outra vez).
 *
 * Se já existir sessão válida, verifica se o utilizador é admin
 * (checkIsAdmin) e envia-o automaticamente para o painel certo:
 *   - admin/index.html se for administrador
 *   - home.html se for utilizador normal
 *
 * Se não houver sessão, simplesmente não faz nada (deixa o
 * formulário de login/registo ser mostrado normalmente).
 */
async function requireGuest() {
  const { data: { session } } = await supabaseClient.auth.getSession();
  if (!session) return;
  const isAdmin = await checkIsAdmin(session.user.id);
  window.location.href = isAdmin ? 'admin/index.html' : 'home.html';
}

/**
 * checkIsAdmin
 * ------------
 * Consulta a tabela `profiles` e devolve true/false dependendo do
 * valor da coluna `is_admin` para o utilizador indicado.
 *
 * Nota de defesa: esta verificação é feita no cliente (browser) só
 * para efeitos de NAVEGAÇÃO/UI (decidir para onde redirecionar, que
 * botões mostrar). A segurança real de quem pode editar o quê tem
 * de estar garantida nas políticas RLS da base de dados — nunca se
 * deve confiar apenas nesta verificação do lado do cliente para
 * proteger dados sensíveis, porque o utilizador pode inspecionar/
 * alterar o JS no browser.
 *
 * @param {string} userId - UUID do utilizador (igual ao id em auth.users
 *                           e à PK da tabela profiles).
 * @returns {Promise<boolean>} true se profiles.is_admin === true.
 */
async function checkIsAdmin(userId) {
  const { data, error } = await supabaseClient
    .from('profiles')
    .select('is_admin')
    .eq('id', userId)
    .single(); // .single() porque esperamos exatamente UMA linha (PK = userId)
  console.log('[Auth] checkIsAdmin →', data, error); // log de depuração, útil para a defesa/demo
  return data?.is_admin === true;
}

/**
 * getCurrentProfile
 * ------------------
 * Devolve o registo completo (todas as colunas, select('*')) da
 * tabela `profiles` correspondente ao utilizador atualmente
 * autenticado. Usado em páginas que precisam de mostrar nome,
 * avatar, bio, etc. do próprio utilizador (ex: profile.html).
 *
 * Se não houver sessão ativa, devolve null sem fazer pedido à BD
 * (evita um erro inútil de "single() não encontrou linha").
 *
 * @returns {Promise<Object|null>} a linha de profiles, ou null.
 */
async function getCurrentProfile() {
  const { data: { session } } = await supabaseClient.auth.getSession();
  if (!session) return null;
  const { data } = await supabaseClient
    .from('profiles').select('*').eq('id', session.user.id).single();
  return data;
}

/**
 * logout
 * ------
 * Termina a sessão no Supabase Auth (invalida o token guardado
 * localmente pelo SDK) e redireciona para a página de login.
 */
async function logout() {
  await supabaseClient.auth.signOut();
  window.location.href = 'login.html';
}

/**
 * showError
 * ---------
 * Helper de UI: escreve uma mensagem de erro num elemento da página
 * (normalmente uma <div> de feedback) e aplica-lhe um estilo inline
 * "vermelho" (cor de erro). Usa estilo inline em vez de classes CSS
 * para garantir que a mensagem fica sempre visível e legível
 * independentemente do CSS específico de cada página.
 *
 * @param {string} elementId - id do elemento onde a mensagem aparece.
 * @param {string} message   - texto a mostrar ao utilizador.
 */
function showError(elementId, message) {
  const el = document.getElementById(elementId);
  if (!el) return; // defensivo: se a página não tiver esse elemento, não falha
  el.textContent = message;
  el.style.cssText = 'display:block;color:#c0392b;background:rgba(192,57,43,0.08);padding:10px 14px;border-radius:8px;margin-top:8px;font-family:sans-serif;font-size:14px;';
}

/**
 * showSuccess
 * -----------
 * Igual a showError, mas com estilo "verde" (sucesso). Usado, por
 * exemplo, depois de criar conta com sucesso ("Conta criada!").
 *
 * @param {string} elementId
 * @param {string} message
 */
function showSuccess(elementId, message) {
  const el = document.getElementById(elementId);
  if (!el) return;
  el.textContent = message;
  el.style.cssText = 'display:block;color:#016e58;background:rgba(1,110,88,0.08);padding:10px 14px;border-radius:8px;margin-top:8px;font-family:sans-serif;font-size:14px;';
}

/**
 * setLoading
 * ----------
 * Dá feedback visual num botão enquanto um pedido assíncrono está a
 * decorrer (ex: enquanto o login está a ser validado no Supabase):
 * desativa o botão (impede duplo clique / duplo submit) e troca o
 * texto para "A processar...". Quando loading=false, repõe o texto
 * original e reativa o botão.
 *
 * @param {string} buttonId    - id do botão a controlar.
 * @param {boolean} loading    - true = a processar, false = pronto.
 * @param {string} originalText - texto a repor quando loading=false.
 */
function setLoading(buttonId, loading, originalText) {
  const btn = document.getElementById(buttonId);
  if (!btn) return;
  btn.disabled = loading;
  btn.textContent = loading ? 'A processar...' : originalText;
}

/**
 * translateError
 * --------------
 * O Supabase Auth devolve mensagens de erro em inglês (ex:
 * "Invalid login credentials"). Esta função faz uma tradução
 * simples por correspondência de texto (includes) para mostrar
 * mensagens mais amigáveis em português ao utilizador.
 *
 * Se a mensagem não corresponder a nenhum dos casos conhecidos,
 * devolve a mensagem original do Supabase tal como veio (fallback
 * seguro — nunca esconde o erro, mesmo que não traduzido).
 *
 * @param {string} msg - mensagem de erro original (error.message).
 * @returns {string} mensagem traduzida (ou original, se não reconhecida).
 */
function translateError(msg) {
  if (msg.includes('Invalid login credentials')) return 'Email ou password incorretos.';
  if (msg.includes('Email not confirmed'))       return 'Confirma o teu email antes de entrar.';
  if (msg.includes('User already registered'))   return 'Este email já está registado.';
  if (msg.includes('Password should be'))        return 'A password deve ter pelo menos 6 caracteres.';
  if (msg.includes('rate limit'))                return 'Demasiadas tentativas. Tenta mais tarde.';
  return msg;
}

/* ───────────────────────────────────────────────────────────────
   Bloco principal: liga os formulários (se existirem na página
   atual) aos respetivos handlers. Corre uma vez quando o DOM
   termina de carregar (DOMContentLoaded).
   ─────────────────────────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', function () {

  // ── REGISTO ──────────────────────────────────────────
  // Só executa este bloco se a página atual tiver o formulário
  // de registo (ou seja, só em register.html).
  const registerForm = document.getElementById('register-form');
  if (registerForm) {
    requireGuest(); // se já estiver logado, é redirecionado e nunca vê este form

    registerForm.addEventListener('submit', async function (e) {
      e.preventDefault(); // impede o reload de página típico de um <form> normal

      // Lê e limpa (trim) os valores dos campos do formulário.
      // O uso de `?.value || ''` protege contra o caso de o
      // elemento não existir (não rebenta com erro).
      const name    = (document.getElementById('input-name')?.value || '').trim();
      const surname = (document.getElementById('input-surname')?.value || '').trim();
      const email   = (document.getElementById('input-email')?.value || '').trim();
      const pwd     = (document.getElementById('input-pwd')?.value || '');
      const pwd2    = (document.getElementById('input-pwd2')?.value || '');

      // Validação no lado do cliente (antes de gastar um pedido à API):
      if (!name || !surname || !email || !pwd) { showError('register-error', 'Preenche todos os campos.'); return; }
      if (pwd !== pwd2) { showError('register-error', 'As passwords não coincidem.'); return; }
      if (pwd.length < 6) { showError('register-error', 'Password com mínimo 6 caracteres.'); return; }

      setLoading('register-submit', true, 'Criar conta');

      // signUp cria o utilizador em auth.users (gerido pelo Supabase)
      // e guarda full_name nos metadados do utilizador (options.data).
      // É a partir destes metadados/trigger no Supabase que
      // normalmente se cria depois a linha correspondente em
      // `profiles` (tabela de perfis da aplicação).
      const { error } = await supabaseClient.auth.signUp({
        email, password: pwd,
        options: { data: { full_name: name + ' ' + surname } }
      });

      setLoading('register-submit', false, 'Criar conta');

      if (error) { showError('register-error', translateError(error.message)); return; }

      showSuccess('register-error', 'Conta criada! Verifica o teu email.');
      // Pequeno delay antes de redirecionar, para o utilizador
      // conseguir ler a mensagem de sucesso.
      setTimeout(() => window.location.href = 'login.html', 2500);
    });
  }

  // ── LOGIN ────────────────────────────────────────────
  // Só executa este bloco em login.html (onde existe #login-form).
  const loginForm = document.getElementById('login-form');
  if (loginForm) {
    requireGuest(); // idem: já logado → redireciona, nunca vê o form

    loginForm.addEventListener('submit', async function (e) {
      e.preventDefault();
      const email = (document.getElementById('login-email')?.value || '').trim();
      const pwd   = (document.getElementById('login-pwd')?.value || '');

      if (!email || !pwd) { showError('login-error', 'Preenche o email e a password.'); return; }

      setLoading('login-submit', true, 'Entrar');

      // Tenta autenticar com email + password. O SDK do Supabase
      // guarda automaticamente o token de sessão (localStorage) se
      // tiver sucesso — não é preciso fazer isso manualmente aqui.
      const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password: pwd });

      setLoading('login-submit', false, 'Entrar');

      if (error) { showError('login-error', translateError(error.message)); return; }

      // Depois de autenticado, verifica se é admin para decidir o
      // destino do redirect (painel de admin vs. app normal).
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
  // Qualquer página que tenha um botão/link com id="logout-btn"
  // (normalmente no menu/perfil) fica automaticamente com a
  // funcionalidade de logout ligada, sem precisar de código extra
  // nessa página.
  const logoutBtn = document.getElementById('logout-btn');
  if (logoutBtn) {
    logoutBtn.addEventListener('click', async function (e) {
      e.preventDefault();
      await logout();
    });
  }

});

/**
 * avatarHTML
 * ----------
 * Helper de UI reutilizado em várias páginas (perfil, lista de
 * membros, mensagens, etc.) para gerar o HTML da "foto" de um
 * utilizador:
 *   - se existir avatarUrl, devolve uma <img> normal com essa URL;
 *   - se NÃO existir (utilizador sem foto), devolve um ícone SVG
 *     genérico de "pessoa" como placeholder, para nunca aparecer
 *     uma imagem partida (broken image) na interface.
 *
 * @param {string|null|undefined} avatarUrl - URL da foto de perfil (ou vazio).
 * @param {string} [size='60%'] - tamanho do SVG quando não há foto
 *                                 (ex: '60%', '24px'); ignorado quando há avatarUrl,
 *                                 onde a imagem ocupa sempre 100% do contentor.
 * @returns {string} fragmento de HTML (string) pronto a inserir via innerHTML.
 */
function avatarHTML(avatarUrl, size) {
  size = size || '60%';
  if (avatarUrl) {
    return `<img src="${avatarUrl}" style="width:100%;height:100%;object-fit:cover">`;
  }
  // Ícone SVG inline (não depende de ficheiro externo) — silhueta
  // simples de pessoa, cor semi-transparente sobre o fundo do avatar.
  return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="rgba(23,42,58,0.35)"><path d="M12 12c2.7 0 8 1.34 8 4v2H4v-2c0-2.66 5.3-4 8-4zm0-2a4 4 0 1 1 0-8 4 4 0 0 1 0 8z"/></svg>`;
}

/* ─────────────────────────────────────────────────────────────────
   Ficheiro de configuração/arranque do cliente Supabase.

   É o PRIMEIRO ficheiro JS a ser carregado em todas as páginas
   (antes de auth.js, home.js, etc.), porque cria a variável global
   `supabaseClient` que todos os outros ficheiros usam para falar
   com a base de dados (tabelas), com a Auth (login/registo) e,
   potencialmente, com o Storage (upload de imagens).

   Nota de defesa: o SUPABASE_ANON_KEY não é um segredo "perigoso" —
   é a chave pública (anon/public key) do Supabase, feita para ser
   usada no browser. A segurança real dos dados não depende de
   esconder esta chave, mas sim das políticas de Row Level Security
   (RLS) configuradas no lado do Supabase: são essas políticas que
   decidem o que cada utilizador pode ler/escrever em cada tabela.
───────────────────────────────────────────────────────────────────── */

// URL do projeto Supabase (identifica a instância/base de dados na cloud).
const SUPABASE_URL = "https://ijswdmvksmqldhkyghwr.supabase.co";

// Chave pública "anon" — usada pelo cliente para autenticar pedidos REST.
// As permissões reais são impostas pelas políticas RLS de cada tabela.
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imlqc3dkbXZrc21xbGRoa3lnaHdyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg3NjYxODgsImV4cCI6MjA5NDM0MjE4OH0.8JuKWiWxKQ0GN-7MmfIcuZE1BAfbNR3oxPMY89amBAM";

// `window.supabase` vem do script externo do SDK (carregado via <script> no
// HTML, normalmente o CDN @supabase/supabase-js). createClient() devolve
// um objeto com tudo o que precisamos: .auth (sessões/login),
// .from('tabela') (queries à BD) e .storage (ficheiros).
//
// `supabaseClient` é declarado aqui SEM "const"/"let" dentro de função,
// portanto fica no escopo global (window.supabaseClient implícito),
// e é isso que permite que auth.js, home.js, item_detail.js, etc.
// o usem diretamente sem precisar de importar nada (não há módulos
// ES6 aqui — é tudo <script> clássico carregado em sequência no HTML).
const supabaseClient = window.supabase.createClient(
    SUPABASE_URL,
    SUPABASE_ANON_KEY
);

# ShareBox

Aplicação web (PWA) para **partilha e troca de objetos dentro da tua comunidade**. Em vez de comprar ou deitar fora, publicas o que já não usas e encontras o que precisas perto de ti.

## Funcionalidades

- Registo, login e recuperação/alteração de palavra-passe
- Publicar, editar e gerir os teus itens (`my_items`)
- Explorar itens, ver detalhes e guardar favoritos
- Comunidades: criar, juntar-te e ver os itens de cada uma
- Chat e mensagens entre utilizadores
- Notificações e perfil público/privado
- Denúncia de conteúdos (`report`) e painel de **administração** (utilizadores, itens, comunidades, denúncias)
- PWA instalável, com suporte offline básico (`manifest.json`, `sw.js`, `offline.html`)

## Tecnologias

- HTML, CSS e JavaScript (sem framework)
- [Supabase](https://supabase.com/) para autenticação e base de dados (cliente em `js/supabase.js`)
- Service Worker + Web App Manifest para funcionalidade de PWA

## Estrutura

```
├── index.html, login.html, register.html ...   páginas da aplicação
├── admin/                                      painel de administração
├── css/                                        estilos por página + globais
├── js/                                         lógica por página, auth e cliente Supabase
├── images/, fonts/                             recursos estáticos
├── manifest.json, sw.js, offline.html          PWA
```

## Como executar localmente

1. Clona o repositório:
   ```bash
   git clone https://github.com/pcpereiraa/sharebox.git
   cd sharebox
   ```
2. Configura o teu projeto Supabase em `js/supabase.js` (`SUPABASE_URL` e `SUPABASE_ANON_KEY`).
3. Serve a pasta com um servidor estático (o Service Worker não funciona via `file://`):
   ```bash
   npx serve .
   # ou
   python3 -m http.server 8000
   ```
4. Abre `http://localhost:8000` no browser.

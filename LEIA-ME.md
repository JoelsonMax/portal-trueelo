# Portal do Cliente True Elo — Etapa 1

Este pacote tem a primeira etapa do portal:

- Entrar, Sair e "Esqueci minha senha", com recuperação por e-mail funcionando de verdade.
- Convite por e-mail: o administrador cadastra a pessoa e ela recebe um link para **"Crie sua senha"**.
- **Alterar senha** em "Minha conta", com link de confirmação enviado por e-mail.
- Menu de acordo com cada um dos 6 papéis.
- **Gerenciar usuários**: adicionar, editar permissões, excluir e redefinir senha (o Proprietário envia o link de redefinição).
- Telas de "Carregando…", "Acesso negado" e "Sessão expirada".
- Layout para computador e celular, instalável na tela inicial.
- **Banco de dados completo**, com as regras de segurança de todas as etapas: documentos, relatórios, linha do tempo, marca e transferência de propriedade.

As telas de Documentos, Relatórios, Linha do Tempo, Marca e Transferência aparecem como "Em construção" e entram nas próximas etapas.

## Estrutura

```
portal-trueelo/
├── web/                     → o site (vai para a sua hospedagem)
│   ├── index.html
│   ├── css/style.css
│   ├── js/app.js
│   ├── js/config.js         → você preenche com os dados do Supabase
│   ├── assets/              → logo e ícones do app
│   ├── manifest.webmanifest → permite "instalar" no celular
│   └── sw.js
└── supabase/
    ├── schema.sql                     → banco de dados e regras de acesso
    └── functions/admin-users/index.ts → gerenciamento de usuários (servidor)
```

## Papéis

| Papel | Pode |
|---|---|
| Administrador Proprietário | Tudo. Também cuida da marca, da transferência de propriedade e da redefinição de senhas. Só existe um. |
| Administrador | Gerenciar usuários abaixo dele, além de documentos, relatórios e serviços |
| Moderador | Gerenciar Editor, Equipe e Usuário, além de documentos, relatórios e serviços |
| Editor | Enviar e editar documentos e relatórios |
| Equipe | Ver os dados dos clientes, sem alterar nada |
| Usuário (cliente) | Ver apenas os próprios documentos, relatórios e linha do tempo |

A regra vale para todos: cada pessoa só gerencia quem está abaixo dela. Essas regras ficam no servidor, então não dá para burlá-las pelo navegador.

---

## Como colocar no ar (passo a passo)

### 1. Criar o projeto no Supabase
1. Crie uma conta em https://supabase.com, de preferência com o e-mail da agência.
2. Clique em **New project**, dê o nome `portal-trueelo`, escolha a região **South America (São Paulo)** e uma senha forte para o banco. Guarde essa senha.

### 2. Criar o banco de dados
1. No menu do projeto, abra **SQL Editor** e clique em **New query**.
2. Cole todo o conteúdo de `supabase/schema.sql` e clique em **Run**. Deve aparecer "Success".
3. (Recomendado) Em **Database → Extensions**, ative `pg_cron`. Depois, no SQL Editor, rode o comando abaixo. Ele conclui as transferências de propriedade automaticamente:
   ```sql
   select cron.schedule('concluir-transferencias', '*/15 * * * *', 'select public.complete_due_transfers()');
   ```

### 3. Configurar o login
Em **Authentication**:
1. **Sign In / Providers → Email**: deixe o Email ligado e **desligue "Allow new users to sign up"**. Assim só entra quem a True Elo convidar.
2. Em **Minimum password length**, coloque 8.
3. **URL Configuration**:
   - **Site URL**: o endereço do portal, ex.: `https://portal.trueelo.com.br`
   - **Redirect URLs**: adicione o mesmo endereço (e `http://localhost:5500` se quiser testar no computador).
4. **Emails → SMTP Settings**: configure um serviço de e-mail próprio (Resend ou Brevo, os dois têm plano gratuito). O e-mail padrão do Supabase é só para testes, tem limite baixo de envios e sai com a marca do Supabase.
5. **Emails → Templates**: troque os textos para português. Há sugestões no fim deste guia.

### 4. Publicar a função de gerenciamento de usuários
Instale a Supabase CLI (https://supabase.com/docs/guides/cli) e, dentro da pasta `portal-trueelo`, rode:
```bash
supabase login
supabase link --project-ref SEU_PROJECT_REF      # aparece na URL do painel
supabase functions deploy admin-users
supabase secrets set SITE_URL=https://portal.trueelo.com.br
```

Se preferir não usar o terminal, faça pelo painel: em **Edge Functions → Deploy a new function → Via Editor**, use o nome `admin-users`, cole o conteúdo de `index.ts` e clique em Deploy. Depois, em **Edge Functions → Secrets**, crie `SITE_URL` com o endereço do portal.

### 5. Criar a conta do Joelson (Proprietário)
1. Em **Authentication → Users → Add user → Send invitation**, digite `agenciatrueelo@gmail.com`.
2. No **SQL Editor**, rode:
   ```sql
   update public.profiles
   set role = 'proprietario', name = 'Joelson Max'
   where email = 'agenciatrueelo@gmail.com';
   ```
3. O Joelson vai receber o convite por e-mail e criar a própria senha. Nenhuma senha fica escrita no código.

### 6. Conectar o site ao Supabase
Em **Project Settings → API**, copie a **Project URL** e a **anon public key** e cole em `web/js/config.js`.
> Não use a `service_role key` no site. Ela dá acesso total ao banco.

Aproveite e preencha também o número do WhatsApp (`WHATSAPP_NUMBER`) nesse arquivo.

### 7. Publicar na sua hospedagem
Envie o **conteúdo da pasta `web/`** para a hospedagem.
- **Hostinger, HostGator ou Locaweb**: pelo Gerenciador de Arquivos, coloque os arquivos dentro de `public_html` (ou de um subdomínio, como `portal.trueelo.com.br`). Ative o SSL gratuito.
- **Netlify ou Vercel** (grátis): arraste a pasta `web` no painel e conecte o seu domínio.

É obrigatório usar **HTTPS**, porque o login e a instalação no celular dependem dele.

### 8. Instalar no celular
Abra o portal no celular:
- **Android (Chrome)**: menu ⋮ → "Instalar app" ou "Adicionar à tela inicial".
- **iPhone (Safari)**: botão Compartilhar → "Adicionar à Tela de Início".

---

## Sugestões de e-mail (Authentication → Emails → Templates)

**Invite user** — Assunto: `Seu acesso ao Portal True Elo`
```html
<h2>Bem-vindo à True Elo!</h2>
<p>Você foi convidado para o seu portal exclusivo, onde vai acompanhar documentos, relatórios e o andamento do seu contrato.</p>
<p><a href="{{ .ConfirmationURL }}">Criar minha senha</a></p>
<p>Se você não esperava este convite, ignore este e-mail.</p>
```

**Reset password** — Assunto: `Redefinição de senha — Portal True Elo`
```html
<h2>Redefinir sua senha</h2>
<p>Recebemos um pedido para criar uma nova senha para o seu acesso ao Portal True Elo.</p>
<p><a href="{{ .ConfirmationURL }}">Criar nova senha</a></p>
<p>Se não foi você, ignore este e-mail. Sua senha atual continua valendo.</p>
```

---

## Próximas etapas
2. Área do cliente: Central de Documentos (com upload de arquivos), Central de Relatórios (recentes, filtro por data e botão do WhatsApp) e Linha do Tempo.
3. Painel admin: enviar documentos, gerenciar relatórios e serviços.
4. Configurações da marca (logo) e transferência de propriedade com contagem de 3 dias.
5. Recuperação por celular (SMS). Exige um serviço pago por mensagem, como o Twilio.

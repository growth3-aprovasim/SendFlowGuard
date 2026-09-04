# 🛡️ SendFlow Guard - Monitoramento & Auto-Recuperação de Links de Grupos

Sistema automatizado desenvolvido em Node.js para verificar periodicamente a integridade dos links de convite dos grupos de WhatsApp da sua campanha no **SendFlow**, além de **monitorar em tempo real o Link Mãe (redirecionador principal)**.

Caso algum link seja revogado ou fique indisponível (sem título na tela do WhatsApp Web), o sistema aciona automaticamente a API do SendFlow para gerar um novo link de convite, aguarda o tempo de propagação e revalida o status do grupo.

---

## 👑 Monitoramento Especial do Link Mãe (Redirecionador Principal)

O **Link Mãe** é o link divulgado nos anúncios/páginas que redireciona os novos leads para os grupos do WhatsApp. Ele é o ativo mais crítico da operação:
- **Verificação Direta e Contínua**: Como não consome o rate-limit do SendFlow, ele pode ser verificado em alta frequência (ex: a cada **30s ou 60s**, configurável no `.env`).
- **Detecção de Redirecionamento e Grupo de Destino**:
  1. O monitor acessa o Link Mãe e segue todos os redirecionamentos.
  2. Confirma se o servidor está online (código 200/301/302).
  3. **Identifica o grupo de destino no WhatsApp**: Inspeciona a integridade do grupo para onde o lead está caindo.
  4. Se o grupo de destino estiver com o link revogado, emite imediatamente o alerta crítico `DESTINATION_REVOKED` no painel e via webhook!

---

## 🚀 Como Funciona a Verificação dos Grupos (SendFlow)

1. **Consulta de Grupos**: O sistema busca todos os grupos da campanha informada via `GET /releases/{releaseId}/groups` da API SendFlow.
2. **Checagem Direta no WhatsApp Web**: Para cada grupo, o sistema inspeciona o link `https://chat.whatsapp.com/{inviteCode}`:
   - **Link Saudável (OK)**: A página do WhatsApp exibe o nome do grupo nas tags `<meta property="og:title">` e `<h3>`.
   - **Link Revogado/Quebrado**: A tag `<h3>` e `og:title` ficam vazios, exibindo apenas "Convite para conversa em grupo".
3. **Auto-Recuperação Imediata**: Ao detectar um link quebrado:
   - Dispara `POST /actions/update-group-invite-code` no SendFlow para a criação de um novo link.
   - Aguarda o tempo de propagação configurado no `.env` (`RECHECK_DELAY_SECONDS`, padrão: 60s).
   - Reconsulta o novo código de convite gerado e retesta a integridade no WhatsApp.
   - Dispara alertas no Discord ou Telegram (caso configurado).
4. **Painel Web em Tempo Real**: Visualize métricas, status de cada grupo, histórico de checagens, countdown para o próximo ciclo e acione verificações manuais com 1 clique.

---

## ⚙️ Instalação e Configuração

### 1. Clonar/Abrir a pasta do projeto
Certifique-se de que o **Node.js (v18+)** está instalado.

### 2. Instalar dependências
```bash
npm install
```

### 3. Configurar o `.env`
Crie ou edite o arquivo `.env` na raiz do projeto com as suas credenciais do SendFlow:

```env
# Chave de API obtida no SendFlow (Bearer Token)
SENDFLOW_API_KEY=sua_chave_de_api_aqui

# URL base da API do SendFlow
SENDFLOW_BASE_URL=https://sendapi.sendflow.pro

# ID da Campanha (releaseId) cujos grupos serão monitorados
SENDFLOW_RELEASE_ID=id_da_sua_campanha_aqui

# Origem das contas: "release" (todas da campanha) ou "accounts"
ACCOUNTS_FROM=release
ACCOUNTS_IDS=

# Intervalo entre verificações (em minutos)
# ⚠️ IMPORTANTE: A API do SendFlow possui rate limit de 10 minutos por releaseId no GET de grupos.
# Por isso, mantenha 10 ou 15 minutos para evitar bloqueio 403.
CHECK_INTERVAL_MINUTES=10

# Tempo de espera (segundos) após solicitar novo link antes de retestar
RECHECK_DELAY_SECONDS=60

# Painel Web (Dashboard)
ENABLE_WEB_DASHBOARD=true
PORT=3000
AUTO_START_SCHEDULER=true

# Notificações Opcionais (Discord / Telegram)
DISCORD_WEBHOOK_URL=
TELEGRAM_BOT_TOKEN=
TELEGRAM_CHAT_ID=
```

---

## 🏃 Como Executar

### Modo Produção / Execução Normal:
```bash
npm start
```

### Modo Desenvolvimento (auto-reload ao editar arquivos):
```bash
npm run dev
```

### Rodar Teste Rápido de Validação de Links:
```bash
npm test
```

---

## 🌐 Painel Web (Dashboard)

Após iniciar o sistema, acesse no navegador:
👉 **[http://localhost:3000](http://localhost:3000)**

Recursos do Painel:
- **Contador Regressivo**: Mostra exatamente quando será a próxima verificação agendada.
- **Tabela de Grupos**: Mostra Nome, Link atual, Status (Ativo / Quebrado / Recuperado), Quantidade de participantes e Última checagem.
- **Botão "Verificar Agora"**: Dispara uma verificação imediata de todos os grupos sob demanda.
- **Botão "Pausar / Iniciar Agendador"**: Permite pausar as checagens automáticas a qualquer momento.
- **Botão "Novo Link"**: Permite forçar a renovação do link de um grupo específico manualmente.
- **Testador Rápido**: Cole qualquer link ou código de grupo do WhatsApp para inspecionar o status em 0.5 segundo.
- **Terminal ao Vivo**: Exibe os logs de execução segundo a segundo.

---

## 🛡️ Proteção Inteligente de Rate Limit do SendFlow

A API do SendFlow aplica as seguintes regras:
- `GET /releases/{releaseId}/groups`: 60s entre requisições de campanhas e **10 minutos por releaseId**.
- `POST /actions/update-group-invite-code`: Até 5 requisições por segundo.

O SendFlow Guard foi projetado especialmente para respeitar essas regras:
- Mantém em cache local os grupos já recuperados caso ocorra uma chamada acidental durante a janela de 10 minutos.
- Evita spam na API caso o usuário clique repetidamente em "Verificar Agora".
- Se a API responder `403 Limite de operações atingido!`, o sistema utiliza o cache em memória para continuar verificando a integridade dos links no WhatsApp sem interrupção.

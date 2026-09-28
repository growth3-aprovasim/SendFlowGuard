# 🛡️ SendFlow Guard - Multi-Campanhas & Auto-Recuperação de Links

Sistema automatizado desenvolvido em Node.js para gerenciar e verificar periodicamente a integridade dos links de convite de **múltiplas campanhas simultaneamente no SendFlow**, além de **monitorar em tempo real o Link Mãe (redirecionador principal)** de cada campanha.

---

## ✨ Principais Recursos

1. **Gestão Multi-Campanhas Direto pelo Painel Web**:
   - Cadastre e gerencie quantas campanhas desejar (ex: 3, 5 ou mais campanhas) sem precisar editar o `.env` ou reiniciar o servidor.
   - Cada campanha possui seu próprio **Nome**, **Release ID do SendFlow**, **Link Mãe**, e opções de contas.
   - Ative, pause, edite ou exclua campanhas com 1 clique na interface.

2. **🛡️ Proteção Rígida contra Derrubada da API do SendFlow (Rate Limit & Safety Lock)**:
   - **Trava Global de Segurança**: Máximo de **4 atualizações a cada 15 minutos** em toda a conta/API Key (a 5ª chamada derrubaria a chave).
   - Fila de auto-recuperação automática: Se múltiplos grupos ou campanhas precisarem de renovação ao mesmo tempo, o sistema enfileira as requisições de forma segura e espaçada.
   - Cache inteligente por Release ID para respeitar o limite de 10 minutos da consulta de grupos.
   - Jitter e delays entre requisições no WhatsApp para proteger seu IP contra bloqueios.

3. **👑 Monitoramento de Links Mãe em Tempo Real**:
   - Monitora os redirecionadores de todas as campanhas cadastradas.
   - Detecta latência, status HTTP e se o destino no WhatsApp está ativo ou revogado (`DESTINATION_REVOKED`).

4. **Dashboard Moderno & Intuitivo**:
   - Abas e filtros por campanha ("Todas as Campanhas" ou campanha específica).
   - Indicador visual em tempo real da cota da API SendFlow (`x/4 disponíveis`).
   - Tabela detalhada de grupos com status, contagem de participantes e ações rápidas.
   - Testador rápido de qualquer link de convite.
   - Console de logs ao vivo.

---

## ⚙️ Configuração Básica (.env)

No arquivo `.env`, você só precisa configurar a sua chave de API e webhooks opcionais. As campanhas podem ser adicionadas diretamente pelo site!

```env
# Chave de API obtida no SendFlow (Bearer Token)
SENDFLOW_API_KEY=sua_chave_de_api_aqui

# URL base da API do SendFlow
SENDFLOW_BASE_URL=https://sendapi.sendflow.pro

# Intervalo padrão entre verificações (em minutos)
CHECK_INTERVAL_MINUTES=10

# Tempo de espera (segundos) após solicitar novo link antes de retestar
RECHECK_DELAY_SECONDS=60

# Painel Web (Dashboard)
PORT=3000
ENABLE_WEB_DASHBOARD=true
AUTO_START_SCHEDULER=true

# Notificações Opcionais (Discord / Telegram / Slack)
DISCORD_WEBHOOK_URL=
SLACK_WEBHOOK_URL=
TELEGRAM_BOT_TOKEN=
TELEGRAM_CHAT_ID=
```

---

## 🏃 Como Executar

### 1. Instalar dependências:
```bash
npm install
```

### 2. Iniciar o servidor:
```bash
npm start
```
Ou em modo desenvolvimento:
```bash
npm run dev
```

### 3. Acessar o Dashboard:
Abra seu navegador em: **[http://localhost:3000](http://localhost:3000)**

Clique em **"+ Nova Campanha"** para adicionar suas campanhas pelo painel!

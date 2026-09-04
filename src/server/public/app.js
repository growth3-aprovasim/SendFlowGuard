// Frontend JavaScript para o Dashboard do SendFlow Guard

let state = {
  isRunning: false,
  nextCheckTime: null,
  schedulerActive: true,
  groups: [],
  logs: [],
  filterQuery: '',
};

let countdownInterval = null;

// Elementos DOM
const campaignIdText = document.getElementById('campaignIdText');
const toggleSchedulerBtn = document.getElementById('toggleSchedulerBtn');
const schedulerText = document.getElementById('schedulerText');
const schedulerIcon = document.getElementById('schedulerIcon');
const verifyNowBtn = document.getElementById('verifyNowBtn');
const verifyBtnLabel = document.getElementById('verifyBtnLabel');
const configAlert = document.getElementById('configAlert');

const systemStateDot = document.getElementById('systemStateDot');
const systemStateText = document.getElementById('systemStateText');
const intervalText = document.getElementById('intervalText');
const lastCheckText = document.getElementById('lastCheckText');
const countdownText = document.getElementById('countdownText');

const metricTotal = document.getElementById('metricTotal');
const metricValid = document.getElementById('metricValid');
const metricRevoked = document.getElementById('metricRevoked');
const metricRecovered = document.getElementById('metricRecovered');

const filterInput = document.getElementById('filterInput');
const groupsTableBody = document.getElementById('groupsTableBody');
const groupsCountBadge = document.getElementById('groupsCountBadge');

const quickTestInput = document.getElementById('quickTestInput');
const quickTestBtn = document.getElementById('quickTestBtn');
const quickTestResult = document.getElementById('quickTestResult');

const logsTerminal = document.getElementById('logsTerminal');
const clearLogsBtn = document.getElementById('clearLogsBtn');

// Elementos do Link Mãe
const masterLinkCard = document.getElementById('masterLinkCard');
const masterLinkStatusBadge = document.getElementById('masterLinkStatusBadge');
const testMasterLinkBtn = document.getElementById('testMasterLinkBtn');
const masterLinkUrlText = document.getElementById('masterLinkUrlText');
const copyMasterLinkBtn = document.getElementById('copyMasterLinkBtn');
const masterDestinationBox = document.getElementById('masterDestinationBox');
const masterLatencyText = document.getElementById('masterLatencyText');
const masterIntervalText = document.getElementById('masterIntervalText');
const masterLinkMsg = document.getElementById('masterLinkMsg');

// Inicialização
document.addEventListener('DOMContentLoaded', () => {
  setupEventListeners();
  fetchStatus();
  setInterval(fetchStatus, 3000);
  startCountdownLoop();
});

function setupEventListeners() {
  // Botão Verificar Agora
  verifyNowBtn.addEventListener('click', async () => {
    try {
      verifyNowBtn.disabled = true;
      verifyBtnLabel.textContent = 'Iniciando...';
      const res = await fetch('/api/verify-now', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ forceRefresh: true }),
      });
      const data = await res.json();
      if (!data.success) {
        alert(data.message || 'Falha ao iniciar verificação.');
      }
      fetchStatus();
    } catch (err) {
      alert('Erro ao conectar ao servidor: ' + err.message);
    }
  });

  // Alternar Agendador
  toggleSchedulerBtn.addEventListener('click', async () => {
    try {
      toggleSchedulerBtn.disabled = true;
      const res = await fetch('/api/scheduler/toggle', { method: 'POST' });
      const data = await res.json();
      toggleSchedulerBtn.disabled = false;
      fetchStatus();
    } catch (err) {
      alert('Erro ao alterar agendador: ' + err.message);
      toggleSchedulerBtn.disabled = false;
    }
  });

  // Filtro de grupos
  filterInput.addEventListener('input', (e) => {
    state.filterQuery = e.target.value.toLowerCase().trim();
    renderGroupsTable();
  });

  // Testador rápido
  quickTestBtn.addEventListener('click', handleQuickTest);
  quickTestInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') handleQuickTest();
  });

  // Limpar logs na tela
  clearLogsBtn.addEventListener('click', () => {
    logsTerminal.innerHTML = '<div class="log-entry log-info">[CONSOLE LIMPO]</div>';
  });

  // Testar Link Mãe
  testMasterLinkBtn.addEventListener('click', async () => {
    try {
      testMasterLinkBtn.disabled = true;
      testMasterLinkBtn.textContent = 'Verificando...';
      const res = await fetch('/api/master-link/check-now', { method: 'POST' });
      const json = await res.json();
      testMasterLinkBtn.disabled = false;
      testMasterLinkBtn.textContent = '⚡ Testar Link Mãe';
      fetchStatus();
    } catch (err) {
      testMasterLinkBtn.disabled = false;
      testMasterLinkBtn.textContent = '⚡ Testar Link Mãe';
      alert('Erro ao testar Link Mãe: ' + err.message);
    }
  });

  // Copiar Link Mãe
  copyMasterLinkBtn.addEventListener('click', () => {
    if (state.masterLink?.url) {
      copyLink(state.masterLink.url);
    }
  });
}

// Busca status da API
async function fetchStatus() {
  try {
    const res = await fetch('/api/status');
    const json = await res.json();
    if (!json.success) return;

    const data = json.data;
    state.isRunning = data.isRunning;
    state.nextCheckTime = data.nextCheckTime;
    state.schedulerActive = data.scheduler?.isActive ?? true;
    state.groups = data.groups || [];
    state.logs = data.logs || [];

    // Alerta de configuração
    if (data.configCheck && !data.configCheck.isValid) {
      configAlert.style.display = 'flex';
      configAlert.querySelector('.alert-desc').textContent = data.configCheck.errors.join(' | ');
    } else {
      configAlert.style.display = 'none';
    }

    // Config info
    campaignIdText.textContent = data.config?.releaseId || 'Não definida';
    intervalText.textContent = `${data.config?.intervalMinutes || 10} min`;

    // Atualiza botão e status de execução
    if (state.isRunning) {
      verifyNowBtn.disabled = true;
      verifyBtnLabel.textContent = 'Verificando...';
      systemStateDot.className = 'dot';
      systemStateDot.style.backgroundColor = '#06b6d4';
      systemStateText.textContent = 'Verificação em Andamento';
    } else {
      verifyNowBtn.disabled = false;
      verifyBtnLabel.textContent = 'Verificar Agora';
      if (state.schedulerActive) {
        systemStateDot.className = 'dot';
        systemStateDot.style.backgroundColor = '#10b981';
        systemStateText.textContent = 'Agendador Ativo';
      } else {
        systemStateDot.className = 'dot paused';
        systemStateText.textContent = 'Agendador Pausado';
      }
    }

    // Botão do agendador
    if (state.schedulerActive) {
      schedulerText.textContent = 'Pausar Agendador';
      schedulerIcon.textContent = '⏸️';
    } else {
      schedulerText.textContent = 'Iniciar Agendador';
      schedulerIcon.textContent = '▶️';
    }

    // Última checagem
    if (data.lastCheckTime) {
      const d = new Date(data.lastCheckTime);
      lastCheckText.textContent = d.toLocaleTimeString('pt-BR');
    }

    // Métricas
    const stats = data.stats || {};
    metricTotal.textContent = state.groups.length || stats.totalGroups || 0;
    metricValid.textContent = stats.validCount || 0;
    metricRevoked.textContent = stats.revokedCount || 0;
    metricRecovered.textContent = stats.recoveredCount || 0;

    groupsCountBadge.textContent = `${state.groups.length} grupos`;

    state.masterLink = data.masterLink;
    renderMasterLink(data.masterLink);
    renderGroupsTable();
    renderLogs(state.logs);
  } catch (err) {
    console.error('Erro ao atualizar status:', err);
  }
}

// Renderiza o card do Link Mãe
function renderMasterLink(masterData) {
  if (!masterData || !masterData.isEnabled) {
    masterLinkStatusBadge.className = 'master-badge badge-unconfigured';
    masterLinkStatusBadge.textContent = '● Não Configurado';
    masterLinkUrlText.textContent = 'Defina MASTER_LINK_URL no arquivo .env';
    masterLinkUrlText.className = 'mono text-muted text-truncate';
    copyMasterLinkBtn.style.display = 'none';
    testMasterLinkBtn.disabled = true;
    masterDestinationBox.innerHTML = '<span class="text-muted text-sm mono">Aguardando configuração no .env</span>';
    masterLatencyText.textContent = '-- ms';
    masterIntervalText.textContent = '--';
    masterLinkMsg.style.display = 'none';
    return;
  }

  testMasterLinkBtn.disabled = false;
  masterIntervalText.textContent = `A cada ${masterData.intervalSeconds || 60}s`;

  // URL e botão copiar
  masterLinkUrlText.textContent = masterData.url;
  masterLinkUrlText.className = 'mono text-truncate text-info font-bold';
  copyMasterLinkBtn.style.display = 'inline-block';

  const res = masterData.lastResult;
  if (!res) {
    masterLinkStatusBadge.className = 'master-badge badge-unconfigured';
    masterLinkStatusBadge.textContent = '⏳ Verificando...';
    masterDestinationBox.innerHTML = '<span class="text-muted text-sm mono">Iniciando primeira checagem...</span>';
    masterLatencyText.textContent = '-- ms';
    masterLinkMsg.style.display = 'none';
    return;
  }

  // Latência
  masterLatencyText.textContent = `${res.durationMs ?? 0} ms`;

  // Status Badge & Mensagem
  if (res.status === 'OPERATIONAL') {
    masterLinkStatusBadge.className = 'master-badge badge-operational';
    masterLinkStatusBadge.textContent = '🟢 Operacional (100% OK)';
    masterLinkMsg.style.display = 'block';
    masterLinkMsg.className = 'master-alert alert-success';
    masterLinkMsg.textContent = res.message;
  } else if (res.status === 'DESTINATION_REVOKED') {
    masterLinkStatusBadge.className = 'master-badge badge-warning';
    masterLinkStatusBadge.textContent = '⚠️ Destino Revogado!';
    masterLinkMsg.style.display = 'block';
    masterLinkMsg.className = 'master-alert alert-danger';
    masterLinkMsg.textContent = res.message;
  } else {
    // OFFLINE
    masterLinkStatusBadge.className = 'master-badge badge-offline';
    masterLinkStatusBadge.textContent = '🔴 Fora do Ar!';
    masterLinkMsg.style.display = 'block';
    masterLinkMsg.className = 'master-alert alert-danger';
    masterLinkMsg.textContent = res.message;
  }

  // Destino Atual (WhatsApp)
  if (res.destinationGroup && res.destinationGroup.isWhatsApp) {
    const dest = res.destinationGroup;
    masterDestinationBox.innerHTML = `
      <a href="${dest.url}" target="_blank" rel="noopener noreferrer" class="link-pill mono">
        ${escapeHtml(dest.title || dest.inviteCode || 'WhatsApp')}
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path><polyline points="15 3 21 3 21 9"></polyline><line x1="10" y1="14" x2="21" y2="3"></line></svg>
      </a>
      <button class="copy-btn" onclick="copyLink('${dest.url}')" title="Copiar Link de Destino">📋</button>
    `;
  } else if (res.finalUrl) {
    masterDestinationBox.innerHTML = `
      <a href="${res.finalUrl}" target="_blank" rel="noopener noreferrer" class="link-pill mono">
        ${escapeHtml(res.finalUrl)}
      </a>
    `;
  } else {
    masterDestinationBox.innerHTML = '<span class="text-danger text-sm mono">Inacessível</span>';
  }
}

// Contador regressivo para próxima checagem
function startCountdownLoop() {
  if (countdownInterval) clearInterval(countdownInterval);
  countdownInterval = setInterval(() => {
    if (!state.nextCheckTime || !state.schedulerActive) {
      countdownText.textContent = state.schedulerActive ? '--:--' : 'Pausado';
      return;
    }

    const diffMs = new Date(state.nextCheckTime).getTime() - Date.now();
    if (diffMs <= 0) {
      countdownText.textContent = 'Executando...';
      return;
    }

    const totalSeconds = Math.floor(diffMs / 1000);
    const mins = Math.floor(totalSeconds / 60);
    const secs = totalSeconds % 60;
    countdownText.textContent = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }, 1000);
}

// Renderiza a tabela de grupos
function renderGroupsTable() {
  let filtered = state.groups;
  if (state.filterQuery) {
    filtered = filtered.filter(g =>
      (g.name || '').toLowerCase().includes(state.filterQuery) ||
      String(g.id || '').toLowerCase().includes(state.filterQuery) ||
      (g.inviteCode || '').toLowerCase().includes(state.filterQuery)
    );
  }

  if (filtered.length === 0) {
    groupsTableBody.innerHTML = `
      <tr>
        <td colspan="6" class="text-center py-6 text-muted">
          ${state.groups.length === 0 ? 'Nenhum grupo verificado ainda. Clique em "Verificar Agora" para sincronizar.' : 'Nenhum grupo encontrado com este filtro.'}
        </td>
      </tr>
    `;
    return;
  }

  groupsTableBody.innerHTML = filtered.map(g => {
    const inviteCode = g.inviteCode || '';
    const fullLink = inviteCode ? `https://chat.whatsapp.com/${inviteCode}` : '';
    
    // Status Badge
    let statusBadge = '<span class="status-tag untested">Não Checado</span>';
    if (g.status === 'VALID') {
      statusBadge = '<span class="status-tag valid">● Ativo (OK)</span>';
    } else if (g.status === 'REVOKED') {
      statusBadge = '<span class="status-tag revoked">⚠ Link Quebrado</span>';
    } else if (g.status === 'RECOVERED') {
      statusBadge = '<span class="status-tag valid">✔ Recuperado</span>';
    } else if (g.status === 'RECOVERY_IN_PROGRESS') {
      statusBadge = '<span class="status-tag recovering">↻ Atualizando...</span>';
    }

    const lastChecked = g.lastCheckedAt
      ? new Date(g.lastCheckedAt).toLocaleTimeString('pt-BR')
      : '--';

    return `
      <tr data-group-id="${g.id}">
        <td>
          <div class="group-name">${escapeHtml(g.name || 'Sem nome')}</div>
          <div class="group-id mono">ID: ${escapeHtml(String(g.id))}</div>
        </td>
        <td>
          ${inviteCode ? `
            <a href="${fullLink}" target="_blank" rel="noopener noreferrer" class="link-pill mono">
              ${inviteCode}
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path><polyline points="15 3 21 3 21 9"></polyline><line x1="10" y1="14" x2="21" y2="3"></line></svg>
            </a>
            <button class="copy-btn" onclick="copyLink('${fullLink}')" title="Copiar Link">📋</button>
          ` : '<span class="text-muted">Sem código</span>'}
        </td>
        <td>${statusBadge}</td>
        <td>
          <div class="mono">${g.participantsAmount ?? '--'} part.</div>
          <div class="text-muted text-sm">${g.full ? '🔴 Cheio' : '🟢 Aberto'}</div>
        </td>
        <td class="mono text-muted text-sm">${lastChecked}</td>
        <td>
          <div class="action-buttons">
            ${inviteCode ? `
              <button class="btn btn-secondary btn-sm" onclick="checkSingleLink('${inviteCode}')" title="Testar link no WhatsApp">
                🔍 Testar
              </button>
            ` : ''}
            <button class="btn btn-secondary btn-sm" onclick="renewGroupLink('${g.id}', '${escapeHtml(g.name || '')}')" title="Disparar criação de novo link no SendFlow">
              🔄 Novo Link
            </button>
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

// Renderiza o console de logs
function renderLogs(logs) {
  if (!logs || logs.length === 0) return;
  logsTerminal.innerHTML = logs.map(l => {
    const levelClass = `log-${l.level || 'info'}`;
    return `<div class="log-entry ${levelClass}">[${l.timeFormatted || '--'}] ${escapeHtml(l.message)}</div>`;
  }).join('');
}

// Ação: Testar link único de um grupo
window.checkSingleLink = async function(inviteCode) {
  try {
    quickTestInput.value = inviteCode;
    handleQuickTest();
  } catch (err) {
    alert('Erro ao testar link: ' + err.message);
  }
};

// Ação: Gerar novo link para um grupo específico
window.renewGroupLink = async function(groupId, groupName) {
  if (!confirm(`Deseja solicitar a geração de um novo link para o grupo "${groupName}" (ID: ${groupId}) no SendFlow?`)) {
    return;
  }
  try {
    const res = await fetch(`/api/groups/${groupId}/renew`, { method: 'POST' });
    const data = await res.json();
    if (data.success) {
      alert(`Ação de renovação enviada com sucesso ao SendFlow!\nAction ID: ${data.actionId || 'OK'}`);
      fetchStatus();
    } else {
      alert(`Falha ao renovar link: ${data.error || 'Erro desconhecido'}`);
    }
  } catch (err) {
    alert('Erro na requisição: ' + err.message);
  }
};

// Testador rápido
async function handleQuickTest() {
  const value = quickTestInput.value.trim();
  if (!value) return;

  quickTestBtn.disabled = true;
  quickTestBtn.textContent = '...';
  quickTestResult.style.display = 'block';
  quickTestResult.className = 'quicktest-result';
  quickTestResult.textContent = 'Testando resposta no WhatsApp Web...';

  try {
    const res = await fetch('/api/check-link', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ link: value }),
    });
    const json = await res.json();
    quickTestBtn.disabled = false;
    quickTestBtn.textContent = 'Testar';

    if (json.success && json.result) {
      const r = json.result;
      if (r.isValid) {
        quickTestResult.className = 'quicktest-result success';
        quickTestResult.innerHTML = `<strong>✅ Link Ativo!</strong><br>Nome detectado: <b>${escapeHtml(r.title)}</b> (${r.durationMs}ms)`;
      } else {
        quickTestResult.className = 'quicktest-result error';
        quickTestResult.innerHTML = `<strong>🚨 Link Quebrado / Revogado!</strong><br>${escapeHtml(r.message)}`;
      }
    } else {
      quickTestResult.className = 'quicktest-result error';
      quickTestResult.textContent = json.error || 'Erro ao validar link.';
    }
  } catch (err) {
    quickTestBtn.disabled = false;
    quickTestBtn.textContent = 'Testar';
    quickTestResult.className = 'quicktest-result error';
    quickTestResult.textContent = 'Erro ao conectar: ' + err.message;
  }
}

window.copyLink = function(text) {
  navigator.clipboard.writeText(text).then(() => {
    alert('Link copiado para a área de transferência!');
  });
};

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// Frontend JavaScript para o Dashboard Multi-Campanhas SendFlow Guard

let state = {
  isRunning: false,
  nextCheckTime: null,
  schedulerActive: true,
  selectedCampaignId: 'all',
  campaigns: [],
  groups: [],
  logs: [],
  masterLink: null,
  cooldown: null,
  stats: {},
  filterQuery: '',
};

let countdownInterval = null;

// Elementos DOM
const apiQuotaBadge = document.getElementById('apiQuotaBadge');
const apiQuotaText = document.getElementById('apiQuotaText');
const activeCampaignsCountText = document.getElementById('activeCampaignsCountText');
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

const campaignTabsContainer = document.getElementById('campaignTabsContainer');
const campaignsCardsGrid = document.getElementById('campaignsCardsGrid');
const allCountBadge = document.getElementById('allCountBadge');

const metricTotal = document.getElementById('metricTotal');
const metricValid = document.getElementById('metricValid');
const metricRevoked = document.getElementById('metricRevoked');
const metricRecovered = document.getElementById('metricRecovered');

const filterInput = document.getElementById('filterInput');
const groupsTableBody = document.getElementById('groupsTableBody');
const groupsCountBadge = document.getElementById('groupsCountBadge');

const safetyCountText = document.getElementById('safetyCountText');
const safetyBarFill = document.getElementById('safetyBarFill');
const safetyCooldownAlert = document.getElementById('safetyCooldownAlert');
const safetyCooldownTime = document.getElementById('safetyCooldownTime');

const quickTestInput = document.getElementById('quickTestInput');
const quickTestBtn = document.getElementById('quickTestBtn');
const quickTestResult = document.getElementById('quickTestResult');

const logsTerminal = document.getElementById('logsTerminal');
const clearLogsBtn = document.getElementById('clearLogsBtn');

// Elementos do Link Mãe
const masterLinkSectionTitle = document.getElementById('masterLinkSectionTitle');
const masterLinkStatusBadge = document.getElementById('masterLinkStatusBadge');
const testMasterLinkBtn = document.getElementById('testMasterLinkBtn');
const masterLinkUrlText = document.getElementById('masterLinkUrlText');
const copyMasterLinkBtn = document.getElementById('copyMasterLinkBtn');
const masterDestinationBox = document.getElementById('masterDestinationBox');
const masterLatencyText = document.getElementById('masterLatencyText');
const masterIntervalText = document.getElementById('masterIntervalText');
const masterLinkMsg = document.getElementById('masterLinkMsg');

// Elementos WhatsApp Protocol
const waBadgeStatus = document.getElementById('waBadgeStatus');
const waConnectedState = document.getElementById('waConnectedState');
const waConnectedNumber = document.getElementById('waConnectedNumber');
const waDisconnectBtn = document.getElementById('waDisconnectBtn');
const waDisconnectedState = document.getElementById('waDisconnectedState');
const waPairingForm = document.getElementById('waPairingForm');
const waPhoneInput = document.getElementById('waPhoneInput');
const waGenerateCodeBtn = document.getElementById('waGenerateCodeBtn');
const waPairingCodeBox = document.getElementById('waPairingCodeBox');
const waCodeDisplay = document.getElementById('waCodeDisplay');
const waCopyCodeBtn = document.getElementById('waCopyCodeBtn');
const waCodeTimer = document.getElementById('waCodeTimer');
const waQrCodeBox = document.getElementById('waQrCodeBox');
const waQrCodeImg = document.getElementById('waQrCodeImg');

// Modal de Campanha
const addCampaignBtn = document.getElementById('addCampaignBtn');
const campaignModal = document.getElementById('campaignModal');
const closeModalBtn = document.getElementById('closeModalBtn');
const cancelModalBtn = document.getElementById('cancelModalBtn');
const campaignForm = document.getElementById('campaignForm');
const modalTitle = document.getElementById('modalTitle');
const formCampaignId = document.getElementById('formCampaignId');
const formName = document.getElementById('formName');
const formReleaseId = document.getElementById('formReleaseId');
const formMasterLink = document.getElementById('formMasterLink');
const formAccountsFrom = document.getElementById('formAccountsFrom');
const formMasterInterval = document.getElementById('formMasterInterval');
const accountsIdsGroup = document.getElementById('accountsIdsGroup');
const formAccountsIds = document.getElementById('formAccountsIds');
const formEnabled = document.getElementById('formEnabled');

// Inicialização
document.addEventListener('DOMContentLoaded', () => {
  setupEventListeners();
  fetchStatus();
  setInterval(fetchStatus, 3000);
  startCountdownLoop();
});

function setupEventListeners() {
  // Disparar Verificação Global Agora
  verifyNowBtn.addEventListener('click', async () => {
    try {
      verifyNowBtn.disabled = true;
      verifyBtnLabel.textContent = 'Iniciando...';
      const endpoint = state.selectedCampaignId === 'all'
        ? '/api/verify-now'
        : `/api/campaigns/${state.selectedCampaignId}/verify-now`;

      const res = await fetch(endpoint, {
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

  // Filtro de grupos na tabela
  filterInput.addEventListener('input', (e) => {
    state.filterQuery = e.target.value.toLowerCase().trim();
    renderGroupsTable();
  });

  // Testador Rápido
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
      const endpoint = state.selectedCampaignId === 'all'
        ? '/api/master-link/check-now'
        : `/api/campaigns/${state.selectedCampaignId}/master-link/check-now`;

      await fetch(endpoint, { method: 'POST' });
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
    const url = masterLinkUrlText.textContent;
    if (url && url.startsWith('http')) {
      copyLink(url);
    }
  });

  // Modal: Abrir para nova campanha
  addCampaignBtn.addEventListener('click', () => {
    openCampaignModal();
  });

  // Modal: Fechar
  closeModalBtn.addEventListener('click', closeCampaignModal);
  cancelModalBtn.addEventListener('click', closeCampaignModal);
  campaignModal.addEventListener('click', (e) => {
    if (e.target === campaignModal) closeCampaignModal();
  });

  // Alternar campo de IDs de contas no formulário
  formAccountsFrom.addEventListener('change', () => {
    accountsIdsGroup.style.display = formAccountsFrom.value === 'accounts' ? 'block' : 'none';
  });

  // Submeter formulário de campanha
  campaignForm.addEventListener('submit', handleSaveCampaign);

  // ==========================================
  // EVENTOS DO WHATSAPP PROTOCOL (PAIRING CODE)
  // ==========================================
  if (waPairingForm) {
    waPairingForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const phone = waPhoneInput.value.trim();
      if (!phone) return;

      waGenerateCodeBtn.disabled = true;
      waGenerateCodeBtn.textContent = 'Gerando...';

      try {
        const res = await fetch('/api/whatsapp/pairing-code', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ phoneNumber: phone }),
        });
        const data = await res.json();
        waGenerateCodeBtn.disabled = false;
        waGenerateCodeBtn.textContent = 'Gerar Código';

        if (data.success && data.pairingCode) {
          waPairingCodeBox.style.display = 'flex';
          waCodeDisplay.textContent = data.pairingCode;
          waCodeTimer.textContent = 'Código válido por 2 minutos. Digite no WhatsApp do seu celular.';
        } else {
          alert(data.error || 'Erro ao gerar código de pareamento.');
        }
        fetchStatus();
      } catch (err) {
        waGenerateCodeBtn.disabled = false;
        waGenerateCodeBtn.textContent = 'Gerar Código';
        alert('Erro ao conectar ao servidor: ' + err.message);
      }
    });
  }

  if (waCopyCodeBtn) {
    waCopyCodeBtn.addEventListener('click', () => {
      const code = waCodeDisplay.textContent.replace(/\s+/g, '');
      if (code && code !== '---------') {
        navigator.clipboard.writeText(code).then(() => {
          alert('Código copiado para a área de transferência!');
        });
      }
    });
  }

  if (waDisconnectBtn) {
    waDisconnectBtn.addEventListener('click', async () => {
      if (!confirm('Deseja realmente desconectar o WhatsApp? O sistema voltará a usar o modo web de contingência.')) {
        return;
      }
      try {
        waDisconnectBtn.disabled = true;
        const res = await fetch('/api/whatsapp/disconnect', { method: 'POST' });
        const data = await res.json();
        waDisconnectBtn.disabled = false;
        if (data.success) {
          alert('WhatsApp desconectado com sucesso.');
          if (waPairingCodeBox) waPairingCodeBox.style.display = 'none';
        }
        fetchStatus();
      } catch (err) {
        waDisconnectBtn.disabled = false;
        alert('Erro ao desconectar: ' + err.message);
      }
    });
  }
}

// Busca status da API
async function fetchStatus() {
  try {
    const query = state.selectedCampaignId !== 'all' ? `?campaignId=${state.selectedCampaignId}` : '';
    const res = await fetch(`/api/status${query}`);
    const json = await res.json();
    if (!json.success) return;

    const data = json.data;
    state.isRunning = data.isRunning;
    state.nextCheckTime = data.nextCheckTime;
    state.schedulerActive = data.scheduler?.isActive ?? true;
    state.campaigns = data.campaigns || [];
    state.groups = data.groups || [];
    state.logs = data.logs || [];
    state.masterLink = data.masterLink;
    state.cooldown = data.cooldown;
    state.stats = data.stats || {};
    state.whatsapp = data.whatsapp;

    // Atualiza Widget do WhatsApp Protocol
    if (data.whatsapp) {
      const wa = data.whatsapp;
      if (wa.isConnected) {
        if (waBadgeStatus) {
          waBadgeStatus.className = 'master-badge badge-active';
          waBadgeStatus.textContent = '● Conectado (Oficial)';
        }
        if (waConnectedState) waConnectedState.style.display = 'block';
        if (waDisconnectedState) waDisconnectedState.style.display = 'none';
        if (waConnectedNumber) waConnectedNumber.textContent = '+' + (wa.phoneNumber || 'Ativo');
      } else {
        if (waBadgeStatus) {
          waBadgeStatus.className = 'master-badge badge-unconfigured';
          waBadgeStatus.textContent = wa.status === 'PAIRING' ? '⏳ Pareando...' : '● Desconectado';
        }
        if (waConnectedState) waConnectedState.style.display = 'none';
        if (waDisconnectedState) waDisconnectedState.style.display = 'block';
        if (wa.lastPairingCode && waPairingCodeBox) {
          waPairingCodeBox.style.display = 'flex';
          if (waCodeDisplay) waCodeDisplay.textContent = wa.lastPairingCode;
        }
        if (wa.qrDataUrl && waQrCodeBox && waQrCodeImg) {
          waQrCodeBox.style.display = 'block';
          waQrCodeImg.src = wa.qrDataUrl;
        } else if (waQrCodeBox) {
          waQrCodeBox.style.display = 'none';
        }
      }
    }

    // Alerta de API KEY
    if (data.configCheck && !data.configCheck.isValid) {
      configAlert.style.display = 'flex';
      configAlert.querySelector('.alert-desc').textContent = data.configCheck.errors.join(' | ');
    } else {
      configAlert.style.display = 'none';
    }

    // Indicadores superiores
    const activeCount = state.campaigns.filter(c => c.enabled !== false).length;
    activeCampaignsCountText.textContent = `${activeCount} de ${state.campaigns.length}`;
    intervalText.textContent = `${data.scheduler?.intervalMinutes || 10} min`;

    // Atualiza botão e status de execução
    if (state.isRunning) {
      verifyNowBtn.disabled = true;
      verifyBtnLabel.textContent = 'Verificando...';
      systemStateDot.className = 'dot';
      systemStateDot.style.backgroundColor = '#06b6d4';
      systemStateText.textContent = 'Verificação em Andamento';
    } else {
      verifyNowBtn.disabled = false;
      verifyBtnLabel.textContent = state.selectedCampaignId === 'all' ? 'Verificar Tudo Agora' : 'Verificar Esta Campanha';
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
    metricTotal.textContent = state.stats.totalGroups || state.groups.length || 0;
    metricValid.textContent = state.stats.validCount || 0;
    metricRevoked.textContent = state.stats.revokedCount || 0;
    metricRecovered.textContent = state.stats.recoveredCount || 0;

    groupsCountBadge.textContent = `${state.groups.length} grupos`;
    allCountBadge.textContent = state.campaigns.length;

    // Renderizações
    renderCampaignTabs();
    renderCampaignsCards();
    renderSafetyMeter(data.cooldown);
    renderMasterLink(data.masterLink);
    renderGroupsTable();
    renderLogs(state.logs);
  } catch (err) {
    console.error('Erro ao atualizar status:', err);
  }
}

// Renderiza a barra de segurança da API
function renderSafetyMeter(cooldown) {
  if (!cooldown) return;

  const count = cooldown.count || 0;
  const max = cooldown.maxAllowed || 4;
  const remaining = cooldown.remainingCount ?? (max - count);

  apiQuotaText.textContent = `${remaining}/${max} disponíveis`;
  safetyCountText.textContent = `${count} / ${max}`;

  const pct = Math.min(100, (count / max) * 100);
  safetyBarFill.style.width = `${pct}%`;

  if (count >= 3) {
    safetyBarFill.className = 'safety-fill danger';
  } else {
    safetyBarFill.className = 'safety-fill';
  }

  if (cooldown.waitMs > 0 && !cooldown.canUpdate) {
    safetyCooldownAlert.style.display = 'block';
    safetyCooldownTime.textContent = cooldown.cooldownText;
  } else {
    safetyCooldownAlert.style.display = 'none';
  }
}

// Renderiza as abas de seleção de campanha
function renderCampaignTabs() {
  const tabs = [
    `<button class="tab-btn ${state.selectedCampaignId === 'all' ? 'active' : ''}" data-campaign-id="all">
      🌐 Todas as Campanhas (${state.campaigns.length})
    </button>`
  ];

  state.campaigns.forEach(camp => {
    const isSel = state.selectedCampaignId === camp.id;
    const isPaused = camp.enabled === false;
    tabs.push(`
      <button class="tab-btn ${isSel ? 'active' : ''} ${isPaused ? 'opacity-70' : ''}" data-campaign-id="${camp.id}">
        ${isPaused ? '⏸️' : '🎯'} ${escapeHtml(camp.name)}
      </button>
    `);
  });

  campaignTabsContainer.innerHTML = tabs.join('');

  campaignTabsContainer.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      state.selectedCampaignId = btn.getAttribute('data-campaign-id');
      fetchStatus();
    });
  });
}

// Renderiza os cards das campanhas
function renderCampaignsCards() {
  if (state.campaigns.length === 0) {
    campaignsCardsGrid.innerHTML = `
      <div class="card p-6 text-center text-muted" style="grid-column: 1 / -1; padding: 24px;">
        Nenhuma campanha cadastrada ainda. Clique no botão <b>"+ Nova Campanha"</b> acima para adicionar sua primeira campanha do SendFlow.
      </div>
    `;
    return;
  }

  campaignsCardsGrid.innerHTML = state.campaigns.map(camp => {
    const isSelected = state.selectedCampaignId === camp.id;
    const isEnabled = camp.enabled !== false;
    const masterLinkStatus = state.masterLink?.campaigns?.[camp.id];
    const isOperational = masterLinkStatus?.lastResult?.status === 'OPERATIONAL';

    return `
      <div class="campaign-card ${isSelected ? 'selected' : ''}" data-id="${camp.id}">
        <div class="camp-card-header">
          <div>
            <div class="camp-card-title">${escapeHtml(camp.name)}</div>
            <div class="camp-card-release mono">Release ID: ${escapeHtml(camp.releaseId)}</div>
          </div>
          <span class="camp-badge-status ${isEnabled ? 'active' : 'paused'}">
            ${isEnabled ? '● Ativa' : '⏸ Pausada'}
          </span>
        </div>

        <div class="camp-card-body">
          <div class="camp-info-row">
            <span class="text-muted text-sm">Link Mãe:</span>
            <span class="mono text-sm ${camp.masterLinkUrl ? (isOperational ? 'text-success' : 'text-info') : 'text-muted'}">
              ${camp.masterLinkUrl ? (isOperational ? '🟢 Operacional' : 'Configurado') : 'Não definido'}
            </span>
          </div>
          <div class="camp-info-row">
            <span class="text-muted text-sm">Origem Contas:</span>
            <span class="mono text-sm">${escapeHtml(camp.accountsFrom || 'release')}</span>
          </div>
        </div>

        <div class="camp-card-actions">
          <button class="btn btn-secondary btn-sm" onclick="selectCampaign('${camp.id}')" title="Filtrar visão nesta campanha">
            🔍 Filtrar
          </button>
          <button class="btn btn-secondary btn-sm" onclick="editCampaign('${camp.id}')" title="Editar configurações da campanha">
            ✏️ Editar
          </button>
          <button class="btn btn-secondary btn-sm" onclick="toggleCampaign('${camp.id}')" title="${isEnabled ? 'Pausar' : 'Ativar'} monitoramento">
            ${isEnabled ? '⏸️ Pausar' : '▶️ Ativar'}
          </button>
          <button class="btn btn-danger-outline btn-sm" onclick="deleteCampaign('${camp.id}', '${escapeHtml(camp.name)}')" title="Excluir campanha">
            🗑️
          </button>
        </div>
      </div>
    `;
  }).join('');
}

// Renderiza o card do Link Mãe
function renderMasterLink(masterData) {
  let targetUrl = '';
  let lastResult = null;
  let intervalSec = 60;
  let title = 'Link Mãe (Redirecionador Principal)';

  if (state.selectedCampaignId !== 'all') {
    const selectedCamp = state.campaigns.find(c => c.id === state.selectedCampaignId);
    if (selectedCamp) {
      title = `Link Mãe • ${selectedCamp.name}`;
      targetUrl = selectedCamp.masterLinkUrl;
      intervalSec = selectedCamp.masterLinkIntervalSeconds || 60;
      lastResult = masterData?.lastResult || masterData?.campaigns?.[selectedCamp.id]?.lastResult;
    }
  } else {
    // Se for 'all', pega a primeira campanha que tiver link mãe configurado
    const firstWithLink = state.campaigns.find(c => Boolean(c.masterLinkUrl));
    if (firstWithLink) {
      title = `Link Mãe • ${firstWithLink.name} (Geral)`;
      targetUrl = firstWithLink.masterLinkUrl;
      intervalSec = firstWithLink.masterLinkIntervalSeconds || 60;
      lastResult = masterData?.campaigns?.[firstWithLink.id]?.lastResult;
    }
  }

  masterLinkSectionTitle.textContent = title;

  if (!targetUrl) {
    masterLinkStatusBadge.className = 'master-badge badge-unconfigured';
    masterLinkStatusBadge.textContent = '● Não Configurado';
    masterLinkUrlText.textContent = 'Cadastre uma campanha com Link Mãe para monitorar';
    masterLinkUrlText.className = 'mono text-muted text-truncate';
    copyMasterLinkBtn.style.display = 'none';
    testMasterLinkBtn.disabled = true;
    masterDestinationBox.innerHTML = '<span class="text-muted text-sm mono">Aguardando configuração de campanha</span>';
    masterLatencyText.textContent = '-- ms';
    masterIntervalText.textContent = '--';
    masterLinkMsg.style.display = 'none';
    return;
  }

  testMasterLinkBtn.disabled = false;
  masterIntervalText.textContent = `A cada ${intervalSec}s`;

  masterLinkUrlText.textContent = targetUrl;
  masterLinkUrlText.className = 'mono text-truncate text-info font-bold';
  copyMasterLinkBtn.style.display = 'inline-block';

  if (!lastResult) {
    masterLinkStatusBadge.className = 'master-badge badge-unconfigured';
    masterLinkStatusBadge.textContent = '⏳ Verificando...';
    masterDestinationBox.innerHTML = '<span class="text-muted text-sm mono">Iniciando checagem...</span>';
    masterLatencyText.textContent = '-- ms';
    masterLinkMsg.style.display = 'none';
    return;
  }

  masterLatencyText.textContent = `${lastResult.durationMs ?? 0} ms`;

  if (lastResult.status === 'OPERATIONAL') {
    masterLinkStatusBadge.className = 'master-badge badge-operational';
    masterLinkStatusBadge.textContent = '🟢 Operacional (100% OK)';
    masterLinkMsg.style.display = 'block';
    masterLinkMsg.className = 'master-alert alert-success';
    masterLinkMsg.textContent = lastResult.message;
  } else if (lastResult.status === 'DESTINATION_REVOKED') {
    masterLinkStatusBadge.className = 'master-badge badge-warning';
    masterLinkStatusBadge.textContent = '⚠️ Destino Revogado!';
    masterLinkMsg.style.display = 'block';
    masterLinkMsg.className = 'master-alert alert-danger';
    masterLinkMsg.textContent = lastResult.message;
  } else {
    masterLinkStatusBadge.className = 'master-badge badge-offline';
    masterLinkStatusBadge.textContent = '🔴 Fora do Ar!';
    masterLinkMsg.style.display = 'block';
    masterLinkMsg.className = 'master-alert alert-danger';
    masterLinkMsg.textContent = lastResult.message;
  }

  if (lastResult.destinationGroup && lastResult.destinationGroup.isWhatsApp) {
    const dest = lastResult.destinationGroup;
    masterDestinationBox.innerHTML = `
      <a href="${dest.url}" target="_blank" rel="noopener noreferrer" class="link-pill mono">
        ${escapeHtml(dest.title || dest.inviteCode || 'WhatsApp')}
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path><polyline points="15 3 21 3 21 9"></polyline><line x1="10" y1="14" x2="21" y2="3"></line></svg>
      </a>
      <button class="copy-btn" onclick="copyLink('${dest.url}')" title="Copiar Link de Destino">📋</button>
    `;
  } else if (lastResult.finalUrl) {
    masterDestinationBox.innerHTML = `
      <a href="${lastResult.finalUrl}" target="_blank" rel="noopener noreferrer" class="link-pill mono">
        ${escapeHtml(lastResult.finalUrl)}
      </a>
    `;
  } else {
    masterDestinationBox.innerHTML = '<span class="text-danger text-sm mono">Inacessível</span>';
  }
}

// Renderiza a tabela de grupos
function renderGroupsTable() {
  let filtered = state.groups;

  if (state.filterQuery) {
    filtered = filtered.filter(g =>
      (g.name || '').toLowerCase().includes(state.filterQuery) ||
      (g.campaignName || '').toLowerCase().includes(state.filterQuery) ||
      String(g.id || '').toLowerCase().includes(state.filterQuery) ||
      (g.inviteCode || '').toLowerCase().includes(state.filterQuery)
    );
  }

  if (filtered.length === 0) {
    groupsTableBody.innerHTML = `
      <tr>
        <td colspan="7" class="text-center py-6 text-muted" style="padding: 24px;">
          ${state.groups.length === 0 ? 'Nenhum grupo verificado ainda nesta visão. Clique em "Verificar Tudo Agora" para sincronizar.' : 'Nenhum grupo encontrado com este filtro de busca.'}
        </td>
      </tr>
    `;
    return;
  }

  groupsTableBody.innerHTML = filtered.map(g => {
    const inviteCode = g.inviteCode || '';
    const fullLink = inviteCode ? `https://chat.whatsapp.com/${inviteCode}` : '';
    
    let statusBadge = '<span class="status-tag untested">Não Checado</span>';
    if (g.status === 'VALID') {
      statusBadge = '<span class="status-tag valid">● Ativo (OK)</span>';
    } else if (g.status === 'REVOKED') {
      statusBadge = '<span class="status-tag revoked">⚠ Link Quebrado</span>';
    } else if (g.status === 'RECOVERED') {
      statusBadge = '<span class="status-tag valid">✔ Recuperado</span>';
    } else if (g.status === 'QUEUED_RATE_LIMIT') {
      statusBadge = '<span class="status-tag recovering">⏳ Fila Cooldown</span>';
    }

    const lastChecked = g.lastCheckedAt
      ? new Date(g.lastCheckedAt).toLocaleTimeString('pt-BR')
      : '--';

    return `
      <tr data-group-id="${g.id}">
        <td>
          <span class="badge font-bold">${escapeHtml(g.campaignName || 'Campanha')}</span>
        </td>
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
          <div class="mono font-bold">${typeof g.size === 'number' ? `${g.size} membros` : (g.participantsAmount != null ? `${g.participantsAmount} part.` : '--')}</div>
          <div class="text-muted text-sm">${g.full ? '🔴 Cheio' : (g.size ? '🟢 Verificado' : '🟢 Aberto')}</div>
        </td>
        <td class="mono text-muted text-sm">${lastChecked}</td>
        <td>
          <div class="action-buttons">
            ${inviteCode ? `
              <button class="btn btn-secondary btn-sm" onclick="checkSingleLink('${inviteCode}')" title="Testar link no WhatsApp">
                🔍 Testar
              </button>
            ` : ''}
            <button class="btn btn-secondary btn-sm" onclick="renewGroupLink('${g.id}', '${escapeHtml(g.name || '')}', '${g.campaignReleaseId || ''}')" title="Disparar criação de novo link no SendFlow">
              🔄 Novo Link
            </button>
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

// Renderiza logs ao vivo
function renderLogs(logs) {
  if (!logs || logs.length === 0) return;
  logsTerminal.innerHTML = logs.map(l => {
    const levelClass = `log-${l.level || 'info'}`;
    return `<div class="log-entry ${levelClass}">[${l.timeFormatted || '--'}] ${escapeHtml(l.message)}</div>`;
  }).join('');
}

// Contador regressivo
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

// ==========================================
// MODAL & AÇÕES DE CAMPANHAS
// ==========================================

function openCampaignModal(campaign = null) {
  campaignForm.reset();
  if (campaign) {
    modalTitle.textContent = 'Editar Campanha';
    formCampaignId.value = campaign.id;
    formName.value = campaign.name || '';
    formReleaseId.value = campaign.releaseId || '';
    formMasterLink.value = campaign.masterLinkUrl || '';
    formAccountsFrom.value = campaign.accountsFrom || 'release';
    formMasterInterval.value = campaign.masterLinkIntervalSeconds || 60;
    formAccountsIds.value = Array.isArray(campaign.accounts) ? campaign.accounts.join(', ') : '';
    formEnabled.checked = campaign.enabled !== false;
    accountsIdsGroup.style.display = campaign.accountsFrom === 'accounts' ? 'block' : 'none';
  } else {
    modalTitle.textContent = 'Nova Campanha';
    formCampaignId.value = '';
    formAccountsFrom.value = 'release';
    formMasterInterval.value = '60';
    formEnabled.checked = true;
    accountsIdsGroup.style.display = 'none';
  }
  campaignModal.style.display = 'flex';
}

function closeCampaignModal() {
  campaignModal.style.display = 'none';
}

async function handleSaveCampaign(e) {
  e.preventDefault();
  const id = formCampaignId.value;
  const payload = {
    name: formName.value.trim(),
    releaseId: formReleaseId.value.trim(),
    masterLinkUrl: formMasterLink.value.trim(),
    accountsFrom: formAccountsFrom.value,
    masterLinkIntervalSeconds: parseInt(formMasterInterval.value, 10),
    accounts: formAccountsIds.value,
    enabled: formEnabled.checked,
  };

  try {
    const url = id ? `/api/campaigns/${id}` : '/api/campaigns';
    const method = id ? 'PUT' : 'POST';

    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    const data = await res.json();
    if (!data.success) {
      alert(data.error || 'Erro ao salvar campanha.');
      return;
    }

    closeCampaignModal();
    fetchStatus();
  } catch (err) {
    alert('Erro de conexão ao salvar campanha: ' + err.message);
  }
}

window.selectCampaign = function(id) {
  state.selectedCampaignId = id;
  fetchStatus();
};

window.editCampaign = function(id) {
  const camp = state.campaigns.find(c => c.id === id);
  if (camp) openCampaignModal(camp);
};

window.toggleCampaign = async function(id) {
  try {
    const res = await fetch(`/api/campaigns/${id}/toggle`, { method: 'POST' });
    const data = await res.json();
    if (data.success) {
      fetchStatus();
    } else {
      alert(data.error || 'Erro ao alternar status da campanha.');
    }
  } catch (err) {
    alert('Erro ao alterar status: ' + err.message);
  }
};

window.deleteCampaign = async function(id, name) {
  if (!confirm(`Tem certeza que deseja excluir a campanha "${name}"? Os links monitorados serão removidos.`)) {
    return;
  }
  try {
    const res = await fetch(`/api/campaigns/${id}`, { method: 'DELETE' });
    const data = await res.json();
    if (data.success) {
      if (state.selectedCampaignId === id) state.selectedCampaignId = 'all';
      fetchStatus();
    } else {
      alert(data.error || 'Erro ao excluir campanha.');
    }
  } catch (err) {
    alert('Erro ao excluir: ' + err.message);
  }
};

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
window.renewGroupLink = async function(groupId, groupName, releaseId) {
  if (!confirm(`Deseja solicitar a geração de um novo link para o grupo "${groupName}" no SendFlow?`)) {
    return;
  }
  try {
    const res = await fetch(`/api/groups/${groupId}/renew`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ releaseId }),
    });
    const data = await res.json();
    if (data.success) {
      alert(`Ação enviada com sucesso ao SendFlow!\n${data.message || 'OK'}`);
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

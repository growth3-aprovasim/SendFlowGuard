import { campaignManager } from '../src/services/campaignManager.js';
import { sendflowClient } from '../src/services/sendflow.js';
import { masterLinkMonitor } from '../src/services/masterLinkMonitor.js';

async function runMultiCampaignTests() {
  console.log('🧪 Iniciando Testes do Sistema Multi-Campanhas & Rate Limiter...\n');

  // Teste 1: Campaign Manager CRUD
  console.log('[TESTE 1] Criando campanhas dinâmicas...');
  const initialCount = campaignManager.getAll().length;

  const camp1 = campaignManager.create({
    name: 'Campanha Teste Alpha',
    releaseId: 'cly_test_alpha_' + Date.now(),
    masterLinkUrl: 'https://sndflw.com/i/teste-alpha',
    enabled: true,
  });

  const camp2 = campaignManager.create({
    name: 'Campanha Teste Beta',
    releaseId: 'cly_test_beta_' + Date.now(),
    masterLinkUrl: 'https://sndflw.com/i/teste-beta',
    enabled: true,
  });

  if (campaignManager.getAll().length !== initialCount + 2) {
    throw new Error('Falha ao adicionar campanhas.');
  }
  console.log('✅ Campanhas criadas com sucesso!');

  // Teste 2: Atualização e Toggle
  console.log('\n[TESTE 2] Atualizando e alternando status...');
  campaignManager.update(camp1.id, { name: 'Campanha Teste Alpha (Editada)' });
  const updatedCamp1 = campaignManager.getById(camp1.id);
  if (updatedCamp1.name !== 'Campanha Teste Alpha (Editada)') {
    throw new Error('Falha ao atualizar nome da campanha.');
  }

  campaignManager.toggle(camp2.id);
  const toggledCamp2 = campaignManager.getById(camp2.id);
  if (toggledCamp2.enabled !== false) {
    throw new Error('Falha ao pausar campanha.');
  }
  console.log('✅ Atualização e toggle funcionando perfeitamente!');

  // Teste 3: Trava de Segurança de Rate Limit da API SendFlow
  console.log('\n[TESTE 3] Verificando controle de rate-limit (máx 4 ações a cada 15 min)...');
  const cooldownStatus = sendflowClient.getUpdateCooldownStatus();
  console.log('Status do Cooldown SendFlow:', cooldownStatus);

  if (typeof cooldownStatus.canUpdate !== 'boolean' || cooldownStatus.maxAllowed !== 4) {
    throw new Error('Status de cooldown inválido.');
  }
  console.log('✅ Trava de segurança da API operacional!');

  // Limpeza dos dados de teste
  campaignManager.delete(camp1.id);
  campaignManager.delete(camp2.id);
  console.log('\n✅ Limpeza concluída.');

  console.log('\n🎉 TODOS OS TESTES MULTI-CAMPANHAS PASSARAM COM SUCESSO! 🎉');
}

runMultiCampaignTests().catch(err => {
  console.error('❌ Erro no teste:', err);
  process.exit(1);
});

import { config, validateConfig } from './config.js';
import { createServer } from './server/app.js';
import { schedulerService } from './services/scheduler.js';
import { verifierService } from './services/verifier.js';
import { masterLinkMonitor } from './services/masterLinkMonitor.js';
import { campaignManager } from './services/campaignManager.js';

function printBanner() {
  const campaigns = campaignManager.getAll();
  const activeCampaigns = campaignManager.getActiveCampaigns();

  console.log(`
===========================================================
   🛡️  SENDFLOW GUARD - MULTI-CAMPANHAS & AUTO-RECUPERAÇÃO  🛡️
===========================================================
  • Campanhas Cadastradas: ${campaigns.length} (${activeCampaigns.length} ativas)
  • Intervalo de Verificação: a cada ${config.scheduler.intervalMinutes} minutos
  • Dashboard Web: http://localhost:${config.server.port}
  • Trava de Segurança API: Máximo 4 atualizações a cada 15 min
===========================================================
`);
}

async function bootstrap() {
  printBanner();

  const validation = validateConfig();
  if (validation.warnings.length > 0) {
    validation.warnings.forEach(w => verifierService.addLog('warn', w));
  }

  if (!validation.isValid) {
    validation.errors.forEach(e => verifierService.addLog('error', `CONFIG: ${e}`));
    console.log('\n⚠️  ATENÇÃO: Configure o arquivo .env com sua SENDFLOW_API_KEY para autenticar na API do SendFlow.\n');
  }

  // Inicializa servidor Web
  if (config.server.enabled) {
    const app = createServer();
    const server = app.listen(config.server.port, () => {
      verifierService.addLog('info', `Painel Web disponível em http://localhost:${config.server.port}`);
    });

    server.on('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        verifierService.addLog(
          'error',
          `A porta ${config.server.port} já está em uso por outro processo! Finalize o processo anterior ou altere a variável PORT no arquivo .env.`
        );
      } else {
        verifierService.addLog('error', `Erro no servidor web: ${err.message}`);
      }
      process.exit(1);
    });
  }

  // Inicializa monitoramento contínuo dos Links Mãe
  masterLinkMonitor.start();

  // Inicializa agendador de checagens automáticas dos grupos
  if (config.scheduler.autoStart) {
    const hasActiveCampaigns = campaignManager.getActiveCampaigns().length > 0;
    schedulerService.start(hasActiveCampaigns && validation.isValid);
  }

  // Tratamento de encerramento seguro
  process.on('SIGINT', () => {
    console.log('\nFinalizando SendFlow Guard com segurança...');
    schedulerService.stop();
    masterLinkMonitor.stop();
    process.exit(0);
  });
}

bootstrap().catch(err => {
  console.error('Falha fatal na inicialização:', err);
  process.exit(1);
});

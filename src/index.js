import { config, validateConfig } from './config.js';
import { createServer } from './server/app.js';
import { schedulerService } from './services/scheduler.js';
import { verifierService } from './services/verifier.js';
import { masterLinkMonitor } from './services/masterLinkMonitor.js';

function printBanner() {
  const masterLinkInfo = config.masterLink.enabled
    ? `${config.masterLink.url} (a cada ${config.masterLink.intervalSeconds}s)`
    : '(não configurado no .env)';

  console.log(`
===========================================================
   🛡️  SENDFLOW GUARD - MONITOR & AUTO-RECUPERAÇÃO  🛡️
===========================================================
  • Campanha (Release ID): ${config.sendflow.releaseId || '(não definida no .env)'}
  • Intervalo Grupos: a cada ${config.scheduler.intervalMinutes} minutos
  • Link Mãe: ${masterLinkInfo}
  • Dashboard Web: http://localhost:${config.server.port}
  • Origem das contas: ${config.sendflow.accountsFrom}
  • Reteste após renovação: ${config.sendflow.recheckDelaySeconds}s
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
    console.log('\n⚠️  ATENÇÃO: Configure o arquivo .env com sua SENDFLOW_API_KEY e SENDFLOW_RELEASE_ID para que o monitoramento funcione.\n');
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

  // Inicializa agendador de checagens automáticas dos grupos
  if (config.scheduler.autoStart) {
    // Se a config for válida, roda primeira verificação
    const shouldRunFirst = validation.isValid;
    schedulerService.start(shouldRunFirst);
  }

  // Inicializa monitoramento contínuo do Link Mãe (independente e de alta frequência)
  if (config.masterLink.enabled) {
    masterLinkMonitor.start();
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

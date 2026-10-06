import { sendflowClient } from '../src/services/sendflow.js';
import { config } from '../src/config.js';

async function testRandomGroupUpdate() {
  console.log('--- TESTE DE RENOVAÇÃO DE LINK DE CONVITE (SENDFLOW) ---');
  const releaseId = config.sendflow.releaseId;
  console.log(`Release ID configurado: ${releaseId}`);

  if (!releaseId) {
    console.error('ERRO: SENDFLOW_RELEASE_ID não configurado no .env');
    process.exit(1);
  }

  try {
    console.log('Buscando grupos da campanha...');
    const result = await sendflowClient.getGroups(releaseId, false);
    const groups = result.groups || [];

    if (groups.length === 0) {
      console.log('Nenhum grupo encontrado nesta campanha.');
      return;
    }

    // Escolhe um grupo aleatório
    const randomGroup = groups[Math.floor(Math.random() * groups.length)];
    console.log(`\nGrupo selecionado para teste:`);
    console.log(`- Nome: ${randomGroup.name}`);
    console.log(`- ID Interno: ${randomGroup.id}`);
    console.log(`- GID WhatsApp: ${randomGroup.gid}`);
    console.log(`- Código Atual: ${randomGroup.inviteCode}`);

    console.log('\nEnviando requisição de atualização para o SendFlow...');
    const res = await sendflowClient.updateGroupInviteCode(randomGroup.gid || randomGroup.id, releaseId);
    console.log('\n✅ RESPOSTA DO SENDFLOW:');
    console.log(JSON.stringify(res, null, 2));

  } catch (err) {
    console.error('\n❌ ERRO NO TESTE:');
    console.error(err.message);
  }
}

testRandomGroupUpdate();

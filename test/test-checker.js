import { WhatsAppChecker } from '../src/services/whatsappChecker.js';

async function runTests() {
  console.log('Iniciando testes do WhatsAppChecker...\n');

  // Link 1: Deve ser válido
  const validUrl = 'https://chat.whatsapp.com/Fc4Q1Ip6ruNDePPLvYNVbr';
  console.log(`[TESTE 1] Testando link que deve estar VÁLIDO: ${validUrl}`);
  const res1 = await WhatsAppChecker.checkInvite(validUrl);
  console.log('Resultado 1:', JSON.stringify(res1, null, 2));

  console.log('\n--------------------------------------------------\n');

  // Link 2: Deve ser revogado
  const invalidUrl = 'https://chat.whatsapp.com/KNRH0Yh3lrp3aHZSGCMPoo';
  console.log(`[TESTE 2] Testando link que deve estar REVOGADO: ${invalidUrl}`);
  const res2 = await WhatsAppChecker.checkInvite(invalidUrl);
  console.log('Resultado 2:', JSON.stringify(res2, null, 2));

  console.log('\n--------------------------------------------------\n');

  if (res1.isValid && !res2.isValid && res2.status === 'REVOKED') {
    console.log('>>> TODOS OS TESTES PASSARAM COM SUCESSO! <<<');
    process.exit(0);
  } else {
    console.error('>>> FALHA NOS TESTES: Verifique a lógica de validação <<<');
    process.exit(1);
  }
}

runTests();

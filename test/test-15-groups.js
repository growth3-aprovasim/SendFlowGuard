import { WhatsAppChecker } from '../src/services/whatsappChecker.js';

async function run() {
  const codes = [
    'DE1aI42ToPsGAJC3pHsost',
    'KpzEwaMeEqO3Dlq6mFxhtp',
    'IIqdMEVRq6b88Ya6rmnmgU',
    'DXOMVrBlrWv0brmkx1riPh',
    'J51lZqjgLBNGUvkVj2OPRu',
    'IsFrol11T5s0CI3OJ4IkFc',
    'DLHhi9xsUm69Z3N8X3imAJ',
    'J2qdmAzIsIH6WvanRFzICz',
    'Buaojll3MfTJ8MjmwqUzfl',
    'FJwJHEAzik81ZO1jfWnzCT',
    'FmfjddviPLI7bOW9kYSY6T',
    'IOVaVsQ3tBf1Vt0i43qAc8',
    'FbAadebUH36I6jIcm9CYgx',
    'EzwUARDpshcF2Y4cMtgBAb',
    'IVcoqc4YZW0BL9Dsjhdr5O'
  ];

  console.log('Testing all 15 groups sequentially...');
  for (let i = 0; i < codes.length; i++) {
    const code = codes[i];
    const res = await WhatsAppChecker.checkInvite(code);
    console.log(`[${i + 1}/${codes.length}] ${code} => isValid: ${res.isValid}, status: ${res.status}, title: "${res.title}", msg: ${res.message} (${res.durationMs}ms)`);
  }
}

run();

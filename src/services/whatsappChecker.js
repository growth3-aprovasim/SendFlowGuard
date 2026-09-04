/**
 * Módulo de Verificação de Integridade de Links de Convite do WhatsApp
 */

export class WhatsAppChecker {
  /**
   * Extrai o código do convite caso tenha vindo como URL completa
   * @param {string} inviteCodeOrUrl 
   * @returns {string}
   */
  static sanitizeInviteCode(inviteCodeOrUrl) {
    if (!inviteCodeOrUrl) return '';
    const str = String(inviteCodeOrUrl).trim();
    // Se for URL https://chat.whatsapp.com/XXXXX
    const match = str.match(/chat\.whatsapp\.com\/([A-Za-z0-9_-]+)/i);
    if (match) return match[1];
    return str.replace(/[^A-Za-z0-9_-]/g, '');
  }

  /**
   * Verifica se o link de convite do WhatsApp está ativo e válido
   * @param {string} inviteCodeOrUrl 
   * @param {object} options
   * @returns {Promise<{
   *   isValid: boolean,
   *   title: string | null,
   *   inviteCode: string,
   *   url: string,
   *   status: 'VALID' | 'REVOKED' | 'NOT_FOUND' | 'ERROR',
   *   message: string,
   *   checkedAt: string,
   *   durationMs: number
   * }>}
   */
  static async checkInvite(inviteCodeOrUrl, options = {}) {
    const startTime = Date.now();
    const inviteCode = this.sanitizeInviteCode(inviteCodeOrUrl);
    const url = `https://chat.whatsapp.com/${inviteCode}`;

    if (!inviteCode) {
      return {
        isValid: false,
        title: null,
        inviteCode: '',
        url: '',
        status: 'ERROR',
        message: 'Código de convite inválido ou vazio.',
        checkedAt: new Date().toISOString(),
        durationMs: 0,
      };
    }

    const timeout = options.timeout || 12000;
    const maxRetries = options.retries ?? 1;

    for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeout);

        const response = await fetch(url, {
          method: 'GET',
          signal: controller.signal,
          headers: {
            'User-Agent':
              'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
            'Accept':
              'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
            'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7',
            'Cache-Control': 'no-cache',
            'Pragma': 'no-cache',
          },
        });

        clearTimeout(timeoutId);

        if (response.status === 404) {
          return {
            isValid: false,
            title: null,
            inviteCode,
            url,
            status: 'NOT_FOUND',
            message: 'Página de convite retornou 404 (Não encontrada).',
            checkedAt: new Date().toISOString(),
            durationMs: Date.now() - startTime,
          };
        }

        const html = await response.text();

        // 1. Extrai o nome do grupo a partir da tag h3 (padrão do WhatsApp Web)
        // Exemplo válido: <h3 class="_9vd5 _9scr" style="color:#1C1E21;">#16 Grupo VIP Banco do Brasil</h3>
        // Exemplo revogado: <h3 class="_9vd5 _9scr" style="color:#1C1E21;"></h3>
        const h3Regex = /<h3[^>]*>(.*?)<\/h3>/gis;
        const h3Matches = [...html.matchAll(h3Regex)].map(m => m[1].replace(/<[^>]*>/g, '').trim());
        const groupH3 = h3Matches.length > 0 ? h3Matches[0] : '';

        // 2. Extrai de metatags OpenGraph (<meta property="og:title" content="...">)
        const ogTitleRegex = /<meta\s+property=["']og:title["']\s+content=["'](.*?)["']/gis;
        const ogMatches = [...html.matchAll(ogTitleRegex)].map(m => m[1].trim());
        const ogTitle = ogMatches.length > 0 ? ogMatches[0] : '';

        // Título final encontrado (seja via h3 ou og:title)
        const detectedTitle = (groupH3 || ogTitle || '').trim();

        // Verifica se há o indicativo "Convite para conversa em grupo"
        const hasInviteText =
          html.includes('Convite para conversa em grupo') ||
          html.includes('Convite para grupo') ||
          html.includes('WhatsApp Group Invite') ||
          html.includes('chat.whatsapp.com');

        // Um link é considerado VÁLIDO se:
        // - O título detectado não for vazio E
        // - O título não for a mensagem genérica de convite E
        // - Não estiver com h3 vazio com o indicativo de convite
        const isRevoked = !detectedTitle || detectedTitle.length === 0;

        if (isRevoked) {
          return {
            isValid: false,
            title: null,
            inviteCode,
            url,
            status: 'REVOKED',
            message: 'Link revogado ou inválido (Nome do grupo vazio na tela de convite).',
            checkedAt: new Date().toISOString(),
            durationMs: Date.now() - startTime,
          };
        }

        return {
          isValid: true,
          title: detectedTitle,
          inviteCode,
          url,
          status: 'VALID',
          message: `Link ativo e funcionando: "${detectedTitle}"`,
          checkedAt: new Date().toISOString(),
          durationMs: Date.now() - startTime,
        };
      } catch (err) {
        const isLastAttempt = attempt === maxRetries + 1;
        if (isLastAttempt) {
          return {
            isValid: false,
            title: null,
            inviteCode,
            url,
            status: 'ERROR',
            message: `Erro ao conectar com WhatsApp (${err.message}).`,
            checkedAt: new Date().toISOString(),
            durationMs: Date.now() - startTime,
          };
        }
        // Espera 1s antes da nova tentativa
        await new Promise(r => setTimeout(r, 1000));
      }
    }
  }
}

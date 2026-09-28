import { config } from '../config.js';

export class Notifier {
  /**
   * Envia notificação sobre detecção de link quebrado ou recuperação
   * @param {object} payload
   */
  static async notify(payload) {
    const { type, group, campaign, oldLink, newLink, error } = payload;

    const timestamp = new Date().toLocaleString('pt-BR');
    const campaignName = campaign?.name || group?.campaignName || 'Campanha SendFlow';
    let title = '';
    let description = '';
    let color = 0x3498db; // Azul padrão

    if (type === 'LINK_REVOKED') {
      title = `🚨 Link de Grupo Quebrado Detectado! [${campaignName}]`;
      description = `**Campanha:** ${campaignName}\n**Grupo:** ${group.name || group.id} (ID: \`${group.id}\`)\n**Link Quebrado:** ${oldLink}\nIniciando processo seguro de auto-recuperação no SendFlow...`;
      color = 0xe74c3c; // Vermelho
    } else if (type === 'LINK_RECOVERED') {
      title = `✅ Link de Grupo Recuperado! [${campaignName}]`;
      description = `**Campanha:** ${campaignName}\n**Grupo:** ${group.name || group.id}\n**Novo Link Ativo:** ${newLink}`;
      color = 0x2ecc71; // Verde
    } else if (type === 'RECOVERY_FAILED') {
      title = `❌ Falha na Recuperação de Link [${campaignName}]`;
      description = `**Campanha:** ${campaignName}\n**Grupo:** ${group.name || group.id}\n**Motivo:** ${error}`;
      color = 0xe67e22; // Laranja
    } else if (type === 'MASTER_LINK_DOWN') {
      title = `💥 URGENTE: Link Mãe Fora do Ar! [${campaignName}]`;
      description = `**Campanha:** ${campaignName}\nO **Link Mãe** está inacessível ou retornando erro!\n**URL:** ${payload.url}\n**Erro:** ${error || payload.message}`;
      color = 0xff0000; // Vermelho intenso
    } else if (type === 'MASTER_LINK_DESTINATION_REVOKED') {
      title = `⚠️ URGENTE: Link Mãe apontando para Grupo Quebrado! [${campaignName}]`;
      description = `**Campanha:** ${campaignName}\nO Link Mãe está online, mas redireciona para um grupo com convite revogado!\n**Link Mãe:** ${payload.url}\n**Destino Atual:** ${payload.finalUrl}`;
      color = 0xe74c3c; // Vermelho
    } else if (type === 'MASTER_LINK_RECOVERED') {
      title = `🟢 Link Mãe Operacional Novamente [${campaignName}]`;
      description = `**Campanha:** ${campaignName}\nO **Link Mãe** voltou a operar e redirecionar normalmente.\n**URL:** ${payload.url}\n**Destino:** ${payload.finalUrl || 'OK'}`;
      color = 0x2ecc71; // Verde
    } else if (type === 'RATE_LIMIT_SAFETY') {
      title = `🛑 Trava de Segurança da API SendFlow Acionada [${campaignName}]`;
      description = `**Campanha:** ${campaignName}\nLimite global de 4 atualizações a cada 15 min atingido!\nO grupo **${group.name || group.id}** foi enfileirado para proteger sua chave de API de ser derrubada.\n**Tempo restante de cooldown:** ${payload.cooldownText || '15 minutos'}.`;
      color = 0xf59e0b; // Laranja/Âmbar
    }

    // Slack Webhook
    if (config.notifications.slackWebhookUrl) {
      try {
        const hexColor = '#' + color.toString(16).padStart(6, '0');
        const slackPayload = {
          text: `*${title}*\n${description.replace(/\*\*/g, '*')}`,
          attachments: [
            {
              color: hexColor,
              fallback: `${title}: ${description}`,
              fields: [
                {
                  title: 'Campanha',
                  value: campaignName,
                  short: true,
                },
                {
                  title: 'Data/Hora',
                  value: timestamp,
                  short: true,
                },
                {
                  title: 'Origem',
                  value: 'SendFlow Guard Monitor',
                  short: true,
                },
              ],
            },
          ],
        };

        await fetch(config.notifications.slackWebhookUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(slackPayload),
        });
      } catch (err) {
        console.error('[Notifier] Erro ao enviar Slack Webhook:', err.message);
      }
    }

    // Discord Webhook
    if (config.notifications.discordWebhookUrl) {
      try {
        await fetch(config.notifications.discordWebhookUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            embeds: [
              {
                title,
                description,
                color,
                footer: { text: `SendFlow Monitor • ${campaignName} • ${timestamp}` },
              },
            ],
          }),
        });
      } catch (err) {
        console.error('[Notifier] Erro ao enviar Discord Webhook:', err.message);
      }
    }

    // Telegram Bot
    if (config.notifications.telegramBotToken && config.notifications.telegramChatId) {
      try {
        const text = `${title}\n\n${description.replace(/\*\*/g, '').replace(/`/g, '')}\n\n🕒 ${timestamp}`;
        const telegramUrl = `https://api.telegram.org/bot${config.notifications.telegramBotToken}/sendMessage`;
        await fetch(telegramUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: config.notifications.telegramChatId,
            text,
          }),
        });
      } catch (err) {
        console.error('[Notifier] Erro ao enviar Telegram:', err.message);
      }
    }
  }
}

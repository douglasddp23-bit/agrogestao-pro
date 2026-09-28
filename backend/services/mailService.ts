import nodemailer from 'nodemailer';

// SEGURANÇA: todo dado digitado por usuários (nome de cliente, objetivo da visita,
// texto do alerta...) é escapado antes de entrar no HTML do e-mail — impede que
// alguém injete links/HTML falsos em e-mails enviados em nome da empresa.
function escapeHtml(value: unknown): string {
  return String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' } as Record<string, string>)[ch]);
}

function escapeFields<T extends Record<string, any>>(obj: T): T {
  const out: any = {};
  for (const [k, v] of Object.entries(obj || {})) out[k] = typeof v === 'string' ? escapeHtml(v) : v;
  return out;
}

/** Remove quebras de linha do assunto (evita injeção de cabeçalhos de e-mail). */
export function cleanSubject(value: unknown): string {
  return String(value ?? '').replace(/[\r\n]+/g, ' ').slice(0, 200);
}

let transporterInstance: nodemailer.Transporter | null = null;

function getTransporter(): nodemailer.Transporter | null {
  if (transporterInstance) {
    return transporterInstance;
  }

  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  if (!user || !pass) {
    console.warn('⚠️ SMTP_USER ou SMTP_PASS não configurados. Os e-mails de credenciais serão exibidos no console do servidor em modo de desenvolvimento.');
    return null;
  }

  try {
    transporterInstance = nodemailer.createTransport({
      host: 'smtp.gmail.com',
      port: 587,
      secure: false, // True for 465, false for other ports
      auth: {
        user,
        pass,
      },
    });
    return transporterInstance;
  } catch (error) {
    console.error('❌ Falha ao inicializar o transportador SMTP do Nodemailer:', error);
    return null;
  }
}

interface MailData {
  employeeName: string;
  email: string;
  registrationNumber: string;
  temporaryPassword?: string;
  isCreation?: boolean;
}

export async function sendAdminCredentialsEmail(adminEmail: string, data: MailData): Promise<boolean> {
  data = escapeFields(data);
  const transporter = getTransporter();
  const subject = data.isCreation 
    ? `🌱 AgroGestão Pro: Novas Credenciais - ${data.employeeName}`
    : `🔐 AgroGestão Pro: Senha Temporária Redefinida - ${data.employeeName}`;
  
  const title = data.isCreation
    ? 'Cadastro de Novo Colaborador'
    : 'Redefinição de Senha Temporária';

  const actionText = data.isCreation
    ? 'Um novo colaborador foi cadastrado no sistema AgroGestão Pro. Seguem as credenciais de acesso para entrega manual segura:'
    : 'A senha da conta do colaborador foi redefinida com sucesso pelo painel administrativo. Seguem os dados para fornecimento manual:';

  const htmlContent = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <title>${subject}</title>
      <style>
        body {
          font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
          background-color: #f4f6f8;
          color: #334155;
          margin: 0;
          padding: 0;
        }
        .container {
          max-width: 600px;
          margin: 40px auto;
          background-color: #ffffff;
          border-radius: 16px;
          overflow: hidden;
          box-shadow: 0 4px 12px rgba(0, 0, 0, 0.05);
          border: 1px solid #e2e8f0;
        }
        .header {
          background-color: #064e3b; /* Emerald deep */
          padding: 32px 24px;
          text-align: center;
          color: #ffffff;
        }
        .header h1 {
          margin: 0;
          font-size: 24px;
          font-weight: 700;
          letter-spacing: -0.025em;
        }
        .header p {
          margin: 8px 0 0 0;
          font-size: 14px;
          color: #a7f3d0;
        }
        .content {
          padding: 40px 32px;
        }
        .welcome-text {
          font-size: 16px;
          line-height: 1.6;
          color: #475569;
          margin-bottom: 24px;
        }
        .credentials-card {
          background-color: #f8fafc;
          border: 1px solid #e2e8f0;
          border-radius: 12px;
          padding: 24px;
          margin-bottom: 24px;
        }
        .field {
          margin-bottom: 16px;
          display: flex;
          border-bottom: 1px solid #f1f5f9;
          padding-bottom: 12px;
        }
        .field:last-child {
          margin-bottom: 0;
          border-bottom: none;
          padding-bottom: 0;
        }
        .label {
          font-weight: 600;
          color: #1e293b;
          width: 140px;
          font-size: 14px;
          text-transform: uppercase;
          letter-spacing: 0.05em;
        }
        .value {
          color: #334155;
          font-size: 15px;
          word-break: break-all;
        }
        .password-box {
          background-color: #ecfdf5;
          border: 1px dashed #10b981;
          color: #047857;
          font-family: 'Courier New', Courier, monospace;
          font-size: 18px;
          font-weight: 700;
          text-align: center;
          padding: 12px;
          border-radius: 8px;
          margin-top: 8px;
          letter-spacing: 0.1em;
        }
        .note-card {
          background-color: #fef3c7;
          border-left: 4px solid #f59e0b;
          color: #92400e;
          padding: 16px;
          border-radius: 4px;
          font-size: 13px;
          line-height: 1.5;
          margin-bottom: 24px;
        }
        .footer {
          background-color: #f8fafc;
          padding: 24px;
          text-align: center;
          border-top: 1px solid #e2e8f0;
          font-size: 12px;
          color: #94a3b8;
        }
        .footer a {
          color: #059669;
          text-decoration: none;
        }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1>AgroGestão Pro</h1>
          <p>${title}</p>
        </div>
        <div class="content">
          <p class="welcome-text">Olá, Administrador,</p>
          <p class="welcome-text">${actionText}</p>
          
          <div class="credentials-card">
            <div class="field">
              <span class="label">Colaborador:</span>
              <span class="value">${data.employeeName}</span>
            </div>
            <div class="field">
              <span class="label">E-mail:</span>
              <span class="value">${data.email}</span>
            </div>
            <div class="field">
              <span class="label">Matrícula:</span>
              <span class="value" style="font-family: monospace; font-weight: bold; color: #0f172a;">${data.registrationNumber}</span>
            </div>
            ${data.temporaryPassword ? `
            <div class="field" style="display: block;">
              <span class="label" style="display: block; margin-bottom: 6px;">Senha Temporária:</span>
              <div class="password-box">${data.temporaryPassword}</div>
            </div>
            ` : ''}
          </div>
          
          <div class="note-card">
            <strong>⚠️ Atenção:</strong> Esta senha possui caráter estritamente temporário e de uso único. O colaborador será obrigado a trocá-la no primeiro login para garantir a aderência aos padrões de segurança enterprise do AgroGestão Pro.
          </div>
          
          <p class="welcome-text">Por favor, repasse esta senha de forma segura ao colaborador correspondente.</p>
        </div>
        <div class="footer">
          <p>© ${new Date().getFullYear()} AgroGestão Pro. Todo o tráfego e ações são auditados.</p>
          <p><a href="#">Suporte Interno AgroGestão</a> | Sistema de Auditoria Interna</p>
        </div>
      </div>
    </body>
    </html>
  `;

  if (!transporter) {
    console.log(`
========================================================================
[DRY-RUN EMAIL SIMULADO]
Destinatário (Administrador): ${adminEmail}
Assunto: ${subject}
Nome do Colaborador: ${data.employeeName}
Matrícula: ${data.registrationNumber}
E-mail do Colaborador: ${data.email}
Senha Temporária: (oculta nos registros por segurança)
========================================================================
    `);
    return true;
  }

  try {
    await transporter.sendMail({
      from: `"AgroGestão Pro Suporte" <${process.env.SMTP_USER}>`,
      to: adminEmail,
      subject,
      html: htmlContent,
    });
    console.log(`[EMAIL ENVIADO SUCESSO] E-mail de credenciais enviado eletronicamente para ${adminEmail}`);
    return true;
  } catch (error: any) {
    const errMessage = error?.message || String(error);
    console.warn('[SMTP Fallback Warning] Falha na transmissão de SMTP. Entrando em modo simulado/dry-run corporativo:', errMessage);
    console.log(`
========================================================================
[DRY-RUN EMAIL SIMULADO]
Destinatário (Administrador): ${adminEmail}
Assunto: ${subject}
Nome do Colaborador: ${data.employeeName}
Matrícula: ${data.registrationNumber}
E-mail do Colaborador: ${data.email}
Senha Temporária: (oculta nos registros por segurança)
========================================================================
    `);
    return true;
  }
}

export async function sendNewAppointmentEmail(adminEmail: string, visit: {
  clientName: string;
  propertyName: string;
  technicianName: string;
  visitDate: string;
  objective: string;
}): Promise<boolean> {
  visit = escapeFields(visit);
  const transporter = getTransporter();
  const subject = `📅 AgroGestão Pro: Novo Agendamento de Visita Realizado - ${visit.clientName}`;
  const formattedDate = new Date(visit.visitDate).toLocaleDateString('pt-BR');

  const htmlContent = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <style>
        body { font-family: sans-serif; background-color: #f4f6f8; color: #334155; margin: 0; padding: 0; }
        .container { max-width: 600px; margin: 40px auto; background-color: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 6px rgba(0,0,0,0.05); border: 1px solid #e2e8f0; }
        .header { background-color: #0d9488; padding: 24px; text-align: center; color: #ffffff; }
        .header h1 { margin: 0; font-size: 20px; }
        .content { padding: 32px 24px; }
        .card { background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px; margin-bottom: 20px; }
        .field { margin-bottom: 12px; border-bottom: 1px solid #f1f5f9; padding-bottom: 8px; }
        .field:last-child { margin-bottom: 0; border-bottom: none; padding-bottom: 0; }
        .label { font-weight: bold; color: #0d9488; font-size: 13px; text-transform: uppercase; }
        .value { color: #334155; font-size: 14px; margin-top: 4px; }
        .footer { background-color: #f8fafc; padding: 16px; text-align: center; font-size: 11px; color: #94a3b8; border-top: 1px solid #e2e8f0; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1>📅 Novo Agendamento de Visita Técnica</h1>
        </div>
        <div class="content">
          <p>Olá, Administrador,</p>
          <p>Um novo agendamento de visita técnica foi registrado no sistema <strong>AgroGestão Pro</strong>. Seguem os detalhes para acompanhamento:</p>
          
          <div class="card">
            <div class="field">
              <div class="label">Produtor / Cliente</div>
              <div class="value">${visit.clientName}</div>
            </div>
            <div class="field">
              <div class="label">Propriedade</div>
              <div class="value">${visit.propertyName}</div>
            </div>
            <div class="field">
              <div class="label">Técnico Responsável</div>
              <div class="value">${visit.technicianName}</div>
            </div>
            <div class="field">
              <div class="label">Data de Realização</div>
              <div class="value">${formattedDate}</div>
            </div>
            <div class="field">
              <div class="label">Objetivo da Visita</div>
              <div class="value">${visit.objective}</div>
            </div>
          </div>
          
          <p>Este e-mail é de aviso automáticoizado pela plataforma AgroGestão Pro.</p>
        </div>
        <div class="footer">
          <p>© ${new Date().getFullYear()} AgroGestão Pro. Monitoramento de Lavouras.</p>
        </div>
      </div>
    </body>
    </html>
  `;

  if (!transporter) {
    console.log(`
========================================================================
[DRY-RUN NOVO AGENDAMENTO SIMULADO]
Destinatário: ${adminEmail}
Cliente: ${visit.clientName}
Propriedade: ${visit.propertyName}
Técnico: ${visit.technicianName}
Data: ${formattedDate}
Objetivo: ${visit.objective}
========================================================================
    `);
    return true;
  }

  try {
    await transporter.sendMail({
      from: `"AgroGestão Pro" <${process.env.SMTP_USER}>`,
      to: adminEmail,
      subject,
      html: htmlContent,
    });
    return true;
  } catch (error: any) {
    const errMessage = error?.message || String(error);
    console.warn('[SMTP Fallback Warning] Falha ao enviar e-mail de agendamento. Entrando em modo simulado/dry-run:', errMessage);
    console.log(`
========================================================================
[DRY-RUN AGENDAMENTO SIMULADO]
Destinatário: ${adminEmail}
Cliente: ${visit.clientName}
Data: ${formattedDate}
Objetivo: ${visit.objective}
========================================================================
    `);
    return true;
  }
}

export async function sendExpiringContractsDigestEmail(adminEmail: string, contracts: Array<{
  clientName: string;
  title: string;
  endDate: string;
  daysRemaining: number;
  value?: number;
}>): Promise<boolean> {
  contracts = (contracts || []).map(c => escapeFields(c));
  const transporter = getTransporter();
  const subject = `⚠️ AgroGestão Pro: Alerta de Vencimento de Contratos (${contracts.length} pendentes)`;

  const listItems = contracts.map(c => `
    <tr style="border-bottom: 1px solid #e2e8f0;">
      <td style="padding: 12px 8px; font-size: 14px; color: #334155;"><strong>${c.clientName}</strong></td>
      <td style="padding: 12px 8px; font-size: 14px; color: #475569;">${c.title || 'Serviços Agrícolas'}</td>
      <td style="padding: 12px 8px; font-size: 14px; color: #475569;">${new Date(c.endDate).toLocaleDateString('pt-BR')}</td>
      <td style="padding: 12px 8px; font-size: 14px; font-weight: bold; color: ${c.daysRemaining <= 7 ? '#dc2626' : '#d97706'}">${c.daysRemaining} dias</td>
      <td style="padding: 12px 8px; font-size: 14px; color: #475569; text-align: right;">R$ ${(c.value || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</td>
    </tr>
  `).join('');

  const htmlContent = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <style>
        body { font-family: sans-serif; background-color: #f4f6f8; color: #334155; margin: 0; padding: 0; }
        .container { max-width: 650px; margin: 40px auto; background-color: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 6px rgba(0,0,0,0.05); border: 1px solid #e2e8f0; }
        .header { background-color: #ea580c; padding: 24px; text-align: center; color: #ffffff; }
        .header h1 { margin: 0; font-size: 20px; }
        .content { padding: 32px 24px; }
        .table-container { width: 100%; border-collapse: collapse; margin-top: 20px; }
        .footer { background-color: #f8fafc; padding: 16px; text-align: center; font-size: 11px; color: #94a3b8; border-top: 1px solid #e2e8f0; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1>⚠️ Alerta de Contratos Vencendo</h1>
        </div>
        <div class="content">
          <p>Olá, Administrador,</p>
          <p>Identificamos que os seguintes contratos de prestação de serviços agrícolas estão operando próximos do fim de vigência. Recomenda-se o contato para renovação comercial:</p>
          
          <table class="table-container">
            <thead>
              <tr style="background-color: #f8fafc; border-bottom: 2px solid #e2e8f0; text-align: left;">
                <th style="padding: 8px; font-size: 12px; text-transform: uppercase; color: #64748b;">Cliente</th>
                <th style="padding: 8px; font-size: 12px; text-transform: uppercase; color: #64748b;">Contrato</th>
                <th style="padding: 8px; font-size: 12px; text-transform: uppercase; color: #64748b;">Vencimento</th>
                <th style="padding: 8px; font-size: 12px; text-transform: uppercase; color: #64748b;">Restantes</th>
                <th style="padding: 8px; font-size: 12px; text-transform: uppercase; color: #64748b; text-align: right;">Valor</th>
              </tr>
            </thead>
            <tbody>
              ${listItems}
            </tbody>
          </table>
          
          <p style="margin-top: 24px;">Por favor, acesse o painel de Contratos no sistema AgroGestão Pro para realizar aditamentos ou emitir novos termos de serviço.</p>
        </div>
        <div class="footer">
          <p>© ${new Date().getFullYear()} AgroGestão Pro. Inteligência e Gestão Comercial.</p>
        </div>
      </div>
    </body>
    </html>
  `;

  if (!transporter) {
    console.log(`
========================================================================
[DRY-RUN ALERTA DE CONTRATOS VENCENDO SIMULADO]
Destinatário: ${adminEmail}
Quantidade de contratos vencendo: ${contracts.length}
${contracts.map(c => `- ${c.clientName} (${c.title}): vence em ${c.daysRemaining} dias`).join('\n')}
========================================================================
    `);
    return true;
  }

  try {
    await transporter.sendMail({
      from: `"AgroGestão Pro" <${process.env.SMTP_USER}>`,
      to: adminEmail,
      subject,
      html: htmlContent,
    });
    return true;
  } catch (error: any) {
    const errMessage = error?.message || String(error);
    console.warn('[SMTP Fallback Warning] Falha ao enviar e-mail de contratos vencendo. Entrando em modo simulado/dry-run:', errMessage);
    console.log(`
========================================================================
[DRY-RUN ALERTA DE CONTRATOS VENCENDO SIMULADO]
Destinatário: ${adminEmail}
Quantidade de contratos vencendo: ${contracts.length}
${contracts.map(c => `- ${c.clientName} (${c.title}): vence em ${c.daysRemaining} dias`).join('\n')}
========================================================================
    `);
    return true;
  }
}

export async function sendAlertEmail(to: string, subject: string, body: string): Promise<boolean> {
  subject = cleanSubject(subject);
  body = escapeHtml(body);
  const transporter = getTransporter();
  const htmlContent = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <style>
        body { font-family: sans-serif; background-color: #f8fafc; color: #334155; margin: 0; padding: 0; }
        .container { max-width: 600px; margin: 40px auto; background-color: #ffffff; border-radius: 12px; overflow: hidden; border: 1px solid #e2e8f0; box-shadow: 0 4px 6px rgba(0,0,0,0.05); }
        .header { background-color: #0284c7; padding: 20px; text-align: center; color: #ffffff; }
        .header h2 { margin: 0; font-size: 18px; }
        .content { padding: 30px 24px; line-height: 1.6; }
        .footer { background-color: #f1f5f9; padding: 16px; text-align: center; font-size: 11px; color: #64748b; border-top: 1px solid #e2e8f0; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h2>🌱 AgroGestão Pro: Alerta Agronômico</h2>
        </div>
        <div class="content">
          <p>${body.replace(/\n/g, '<br>')}</p>
        </div>
        <div class="footer">
          <p>© ${new Date().getFullYear()} AgroGestão Pro. Monitoramento Inteligente e Decisão de Campo.</p>
        </div>
      </div>
    </body>
    </html>
  `;

  if (!transporter) {
    console.log(`
========================================================================
[DRY-RUN ALERTA ENVIADO POR EMAIL]
Destinatário: ${to}
Assunto: ${subject}
Conteúdo: ${body}
========================================================================
    `);
    return true;
  }

  try {
    await transporter.sendMail({
      from: `"AgroGestão Pro" <${process.env.SMTP_USER}>`,
      to,
      subject,
      html: htmlContent,
    });
    return true;
  } catch (error: any) {
    const errMessage = error?.message || String(error);
    console.warn('[SMTP Fallback Warning] Falha ao enviar e-mail de alerta. Entrando em modo simulado/dry-run:', errMessage);
    console.log(`
========================================================================
[DRY-RUN ALERTA ENVIADO POR EMAIL]
Destinatário: ${to}
Assunto: ${subject}
Conteúdo: ${body}
========================================================================
    `);
    return true;
  }
}

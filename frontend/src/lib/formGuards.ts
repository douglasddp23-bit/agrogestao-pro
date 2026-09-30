// Validação GERAL de formulários (auditoria de segurança de 30/09/2026).
//
// Cada tela já confere os seus campos obrigatórios; esta camada vale para o
// sistema inteiro, antes de qualquer formulário ser enviado:
//   • campos numéricos: número de verdade e sem valor negativo (salvo se o campo
//     tiver data-allow-negative ou um "min" negativo);
//   • e-mail: formato nome@dominio.ext;
//   • datas: ano entre 1900 e 2100;
//   • textos: tamanho máximo (campos sem limite recebem um padrão).
// As mesmas regras são conferidas de novo pelo banco (firestore.rules), que é
// quem realmente protege — a tela só evita o erro e explica ao usuário.

import { toast } from 'sonner';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DEFAULT_INPUT_MAX = 500;
const DEFAULT_TEXTAREA_MAX = 20000;

function labelOf(el: HTMLElement): string {
  const id = el.getAttribute('id');
  const byFor = id ? document.querySelector(`label[for="${CSS.escape(id)}"]`) : null;
  const wrap = el.closest('div')?.querySelector('label');
  const text = (byFor?.textContent || wrap?.textContent || el.getAttribute('placeholder') || el.getAttribute('name') || '').trim();
  return text.replace(/\s*\*$/, '').slice(0, 60) || 'campo';
}

/** Confere um campo; devolve a mensagem de erro ou null. */
export function checkField(el: HTMLInputElement | HTMLTextAreaElement): string | null {
  const value = el.value ?? '';
  if (el instanceof HTMLInputElement) {
    const type = el.type;
    if (type === 'number' && value !== '') {
      const n = Number(value);
      if (!Number.isFinite(n)) return `"${labelOf(el)}": digite um número válido.`;
      const minAttr = el.getAttribute('min');
      const min = minAttr !== null && minAttr !== '' ? Number(minAttr) : (el.dataset.allowNegative !== undefined ? -Infinity : 0);
      if (n < min) return `"${labelOf(el)}" não pode ser menor que ${min}.`;
      if (Math.abs(n) > 1e12) return `"${labelOf(el)}": valor grande demais.`;
    }
    if (type === 'email' && value.trim() !== '' && !EMAIL_RE.test(value.trim())) {
      return `"${labelOf(el)}": e-mail inválido (use o formato nome@empresa.com).`;
    }
    if (type === 'date' && value !== '') {
      const y = Number(value.slice(0, 4));
      if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || y < 1900 || y > 2100) return `"${labelOf(el)}": data inválida.`;
    }
  }
  const max = el.maxLength > 0 ? el.maxLength : 0;
  if (max && value.length > max) return `"${labelOf(el)}" passou do limite de ${max} caracteres.`;
  return null;
}

/** Confere todos os campos de um formulário/área. Mostra o 1º erro e devolve false. */
export function validateContainer(root: ParentNode): boolean {
  const fields = Array.from(root.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('input, textarea'))
    .filter(el => !el.disabled && !el.readOnly && el.type !== 'hidden' && el.type !== 'file');
  for (const el of fields) {
    const err = checkField(el);
    if (err) {
      toast.error(err);
      try { el.focus(); } catch { /* campo fora da tela */ }
      return false;
    }
  }
  return true;
}

function applyDefaults(el: Element) {
  if (el instanceof HTMLTextAreaElement) {
    if (!(el.maxLength > 0)) el.maxLength = DEFAULT_TEXTAREA_MAX;
  } else if (el instanceof HTMLInputElement) {
    if (['text', 'search', 'email', 'tel', 'url', 'password', ''].includes(el.type) && !(el.maxLength > 0)) {
      el.maxLength = el.type === 'password' ? 128 : DEFAULT_INPUT_MAX;
    }
  }
}

let installed = false;

/** Liga a validação geral no app inteiro (chamar uma vez, ao iniciar). */
export function installFormGuards() {
  if (installed || typeof document === 'undefined') return;
  installed = true;

  // Antes do React receber o "enviar": se algum campo estiver errado, o envio para aqui.
  document.addEventListener('submit', (e) => {
    const form = e.target as HTMLFormElement;
    if (!(form instanceof HTMLFormElement)) return;
    if (!validateContainer(form)) {
      e.preventDefault();
      e.stopImmediatePropagation();
    }
  }, true);

  // Limite de tamanho padrão em todos os campos de texto (inclusive os que aparecem depois)
  document.querySelectorAll('input, textarea').forEach(applyDefaults);
  new MutationObserver((mutations) => {
    for (const m of mutations) {
      m.addedNodes.forEach((n) => {
        if (!(n instanceof Element)) return;
        if (n.matches('input, textarea')) applyDefaults(n);
        n.querySelectorAll?.('input, textarea').forEach(applyDefaults);
      });
    }
  }).observe(document.documentElement, { childList: true, subtree: true });
}
